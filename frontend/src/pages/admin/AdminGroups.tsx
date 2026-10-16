import { Building2, UserMinus, UserPlus, Users } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import { type AdminGroup, type AdminUser, api, type CatalogState, type GroupSource } from "../../api";
import { ConfirmPanel } from "../../components/admin/ConfirmPanel";
import { DataList, DataListSection, DataRow, ListSkeleton, TombstoneRow } from "../../components/admin/DataList";
import { Toolbar } from "../../components/admin/Toolbar";
import { EmptyState } from "../../components/EmptyState";
import { ErrorSummary } from "../../components/form/ErrorSummary";
import { Field } from "../../components/form/Field";
import { FormActions, FormStack } from "../../components/form/FormLayout";
import { InlineForm } from "../../components/form/InlineForm";
import { PendingButton, SubmitButton } from "../../components/form/PendingButton";
import { LoadError } from "../../components/LoadError";
import { Page } from "../../components/Page";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import type { Messages } from "../../i18n/en";
import { useStrings } from "../../i18n/LocaleProvider";
import { useAdminCollection } from "../../lib/admin-collection";
import { focusIsLost, rowHasFocus, type RowPanel, useListFeedback, useRowPanel, withTombstones } from "../../lib/admin-list";
import { useAnnounce, useDebouncedStatus } from "../../lib/announcer";
import { matchesFilter, prepareFilter } from "../../lib/filter";
import { claimFocus, focusById } from "../../lib/focus";
import { useFormErrors } from "../../lib/form-errors";
import { invalidateHome } from "../../lib/home-store";
import { AdminPageHeader } from "./AdminLayout";
import { adminErrorText, isNotFound } from "./shared";

const NEW = "new";
const FILTER_ID = "groups-filter";
const SECTIONS = ["system", "local", "oidc"] as const satisfies readonly GroupSource[];
/** Members listed before the panel offers a filter of its own. */
const MEMBER_FILTER_FROM = 10;
/** People the picker lists at most: the search narrows the rest. */
const PICKER_LIMIT = 8;

type Data = { groups: AdminGroup[]; users: AdminUser[]; catalog: CatalogState };

const load = async (): Promise<Data> => {
  const [groups, users, catalog] = await Promise.all([api.groups(), api.users(), api.catalogState()]);
  return { groups, users, catalog };
};

/** Return the id of the button that opens a panel: `new`, or `<kind>:<group id>` with kind members, rename or delete. */
function groupTrigger(key: string): string {
  if (key === NEW) return "groups-new";
  const at = key.indexOf(":");
  return `group-${key.slice(at + 1)}-${key.slice(0, at)}`;
}

const removeButtonId = (groupId: string, userId: string) => `member-${groupId}-${userId}-remove`;
const pickerId = (groupId: string) => `group-${groupId}-picker`;

/** Return the name a group is shown with: built-in groups are translated, the others shown as named. */
function displayName(group: AdminGroup, m: Messages): string {
  if (group.source !== "system") return group.name;
  return (m.groups.system as Record<string, { name: string } | undefined>)[group.name]?.name ?? group.name;
}

/** Return whether CATALOG_FILE locks the group: it manages the catalog, and the catalog uses this group. */
const lockedByFile = (group: AdminGroup, catalog: CatalogState) => catalog.managedByFile && group.categories + group.links > 0;

/** Admin page: list every group by origin, manage local ones and their members; OIDC and built-in groups are read-only. */
export function AdminGroups() {
  const m = useStrings();
  const s = m.groups;
  const announce = useAnnounce();
  const collection = useAdminCollection(load);
  const panel = useRowPanel(groupTrigger);
  const feedback = useListFeedback();
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [memberErrors, setMemberErrors] = useState<Record<string, { text: string; n: number }>>({});

  const data = collection.data;
  const filter = useMemo(() => prepareFilter(data?.groups ?? [], (g) => [displayName(g, m), g.source === "system" ? `@${g.name}` : g.name]), [data, m]);
  const shown = useMemo(() => {
    if (!data) return [];
    const matched = new Set(filter(query).map((g) => g.id));
    return data.groups.filter((g) => matched.has(g.id) || g.id === feedback.pinned);
  }, [data, filter, query, feedback.pinned]);
  const shownRef = useRef(shown);
  useEffect(() => {
    shownRef.current = shown;
  });

  const changeQuery = (next: string) => {
    setQuery(next);
    feedback.clearForFilter();
  };

  const toggle = (key: string) => {
    feedback.clear();
    setMemberErrors({});
    panel.toggle(key);
  };

  /**
   * After a success: close the panel that ran it and focus `focusId`; if the person moved on (`stillOpen` false),
   * only say it.
   */
  const succeed = (stillOpen: () => boolean, text: string, focusId: string) => {
    const open = stillOpen();
    if (open) panel.close();
    feedback.say(text, open ? focusById(focusId) : undefined);
    void collection.refresh();
  };

  /**
   * Replace the row of a group the server no longer has by a message, then reload. The message takes the focus when
   * the focus is in the row (its panel, or its buttons after Cancel) or lost; elsewhere it is only announced.
   */
  const gone = (group: AdminGroup, stillOpen: () => boolean, text = m.admin.errors.not_found, variant: "success" | "destructive" = "destructive") => {
    if (stillOpen()) panel.close();
    if (rowHasFocus(`group-${group.id}-title`) || focusIsLost()) {
      const section = shownRef.current.filter((g) => g.source === group.source);
      feedback.bury({ id: group.id, text, variant, section: group.source, index: Math.max(0, section.findIndex((g) => g.id === group.id)) });
    } else announce(text);
    collection.setData((d) => ({ ...d, groups: d.groups.filter((g) => g.id !== group.id) }));
    void collection.refresh();
  };

  /** Report the failure of a row action: in its panel when still open (rethrown), else in the row. */
  const failed = (group: AdminGroup, stillOpen: () => boolean, err: unknown) => {
    if (isNotFound(err)) return gone(group, stillOpen);
    if (stillOpen()) throw err;
    feedback.rowError(group.id, adminErrorText(err, m));
  };

  const replaceGroup = (group: AdminGroup) => collection.setData((d) => ({ ...d, groups: d.groups.map((g) => (g.id === group.id ? group : g)) }));

  async function create(name: string) {
    const stillOpen = panel.claim(NEW);
    let group: AdminGroup;
    try {
      ({ group } = await api.createGroup(name));
    } catch (err) {
      if (stillOpen()) throw err;
      // The form is gone: say it under the toolbar, where it was; the alert is read as it appears.
      feedback.rowError(NEW, adminErrorText(err, m));
      return;
    }
    collection.setData((d) => ({ ...d, groups: [...d.groups, group] }));
    // Shown whatever the filter, which stays as typed.
    feedback.pin(group.id);
    succeed(stillOpen, s.created(group.name), `group-${group.id}-members`);
  }

  async function rename(group: AdminGroup, name: string) {
    const key = `rename:${group.id}`;
    if (name.trim() === group.name) return panel.cancel();
    const stillOpen = panel.claim(key);
    try {
      const { group: renamed } = await api.renameGroup(group.id, name);
      replaceGroup(renamed);
      feedback.pin(renamed.id);
      invalidateHome();
      succeed(stillOpen, s.renamed(renamed.name), groupTrigger(key));
    } catch (err) {
      failed(group, stillOpen, err);
    }
  }

  async function remove(group: AdminGroup) {
    const stillOpen = panel.claim(`delete:${group.id}`);
    try {
      await api.deleteGroup(group.id);
    } catch (err) {
      return failed(group, stillOpen, err);
    }
    invalidateHome();
    gone(group, stillOpen, s.deleted(group.name), "success");
  }

  const setPair = (pair: string, on: boolean) =>
    setPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(pair);
      else next.delete(pair);
      return next;
    });

  const clearMemberError = (groupId: string) =>
    setMemberErrors((prev) => {
      if (!Object.hasOwn(prev, groupId)) return prev;
      const next = { ...prev };
      delete next[groupId];
      return next;
    });

  /**
   * Report a failed member change. A not_found first reloads: when the group itself is gone, its row becomes a
   * message, and nothing else is shown. Otherwise the error goes in the members panel, focused, or in the row when
   * the panel was closed.
   */
  const memberFailed = async (group: AdminGroup, stillOpen: () => boolean, err: unknown) => {
    if (isNotFound(err)) {
      // Resolves before the reload renders, so the row, its place and the focus in it can still be read.
      const fresh = await collection.refresh();
      if (fresh && !fresh.groups.some((g) => g.id === group.id)) return gone(group, stillOpen);
    }
    const text = adminErrorText(err, m);
    if (stillOpen()) setMemberErrors((prev) => ({ ...prev, [group.id]: { text, n: (prev[group.id]?.n ?? 0) + 1 } }));
    else feedback.rowError(group.id, text);
  };

  /** Run a member change with its button pending until the outcome is shown; return whether it succeeded. */
  async function changeMember(group: AdminGroup, user: AdminUser, stillOpen: () => boolean, request: () => Promise<void>): Promise<boolean> {
    const pair = `${group.id}:${user.id}`;
    setPair(pair, true);
    feedback.clear();
    clearMemberError(group.id);
    try {
      await request();
      return true;
    } catch (err) {
      await memberFailed(group, stillOpen, err);
      return false;
    } finally {
      setPair(pair, false);
    }
  }

  async function addMember(group: AdminGroup, user: AdminUser) {
    const stillOpen = panel.claim(`members:${group.id}`);
    if (!(await changeMember(group, user, stillOpen, () => api.addMember(group.id, user.id)))) return;
    invalidateHome();
    collection.setData((d) => ({ ...d, groups: d.groups.map((g) => (g.id === group.id ? { ...g, memberIds: [...g.memberIds.filter((id) => id !== user.id), user.id] } : g)) }));
    feedback.say(s.added(user.name, group.name), stillOpen() ? focusById(pickerId(group.id)) : undefined);
    void collection.refresh();
  }

  async function removeMember(group: AdminGroup, user: AdminUser, neighbours: { next?: string; previous?: string }) {
    const stillOpen = panel.claim(`members:${group.id}`);
    if (!(await changeMember(group, user, stillOpen, () => api.removeMember(group.id, user.id)))) return;
    invalidateHome();
    collection.setData((d) => ({ ...d, groups: d.groups.map((g) => (g.id === group.id ? { ...g, memberIds: g.memberIds.filter((id) => id !== user.id) } : g)) }));
    const target = neighbours.next ?? neighbours.previous;
    const focused = stillOpen() ? focusById(target ? removeButtonId(group.id, target) : pickerId(group.id)) : undefined;
    feedback.say(s.removed(user.name, group.name), focused);
    void collection.refresh();
  }

  const total = data?.groups.length ?? 0;
  const count = !data ? "" : query.trim() ? s.countFiltered(shown.length, total) : s.count(total);
  const sections = SECTIONS.map((source) => ({
    source,
    entries: withTombstones(
      shown.filter((g) => g.source === source),
      feedback.tombstones.filter((t) => t.section === source),
    ),
  })).filter((section) => section.entries.length > 0);

  return (
    <Page width="list">
      <div onKeyDown={panel.onKeyDown}>
        <AdminPageHeader tab="groups" description={s.description} />
        {collection.status === "error" ? (
          <LoadError attempt={collection.attempt} message={s.loadError} pending={collection.retrying} onRetry={collection.retry} />
        ) : (
          <>
            <Toolbar
              filterId={FILTER_ID}
              filterLabel={s.filter}
              query={query}
              onQueryChange={changeQuery}
              count={count}
              status={feedback.status}
              action={
                <Button id="groups-new" aria-expanded={panel.isOpen(NEW)} aria-controls={panel.isOpen(NEW) ? "groups-new-panel" : undefined} onClick={() => toggle(NEW)}>
                  <UserPlus aria-hidden="true" />
                  {s.add}
                </Button>
              }
            />
            {panel.isOpen(NEW) && (
              <div id="groups-new-panel" className="mb-4 rounded-xl border bg-muted/40 p-4">
                <GroupNameForm id="groups-new-form" label={s.newTitle} submitLabel={s.create} pendingLabel={s.creating} initial="" onSubmit={create} onCancel={panel.cancel} />
              </div>
            )}
            {feedback.rowErrors[NEW] && (
              <Alert variant="destructive" className="mb-4">
                {feedback.rowErrors[NEW]}
              </Alert>
            )}
            {collection.refreshFailures > 0 && (
              <Alert key={collection.refreshFailures} variant="warning" className="mb-4">
                {m.admin.refreshFailed}
              </Alert>
            )}
            {!data ? (
              <ListSkeleton />
            ) : sections.length === 0 ? (
              <EmptyState
                title={m.admin.noMatch(query.trim())}
                actions={
                  <Button
                    variant="outline"
                    onClick={() => {
                      changeQuery("");
                      void focusById(FILTER_ID);
                    }}
                  >
                    {m.admin.clearFilter}
                  </Button>
                }
              />
            ) : (
              <div className="flex flex-col gap-8">
                {sections.map(({ source, entries }) => (
                  <DataListSection key={source} id={`groups-${source}`} title={s.sections[source]}>
                    <DataList labelledBy={`groups-${source}`}>
                      {entries.map((entry) =>
                        entry.kind === "tombstone" ? (
                          <TombstoneRow key={`tombstone-${entry.tombstone.id}`} tombstone={entry.tombstone} />
                        ) : (
                          <GroupRow
                            key={entry.item.id}
                            group={entry.item}
                            data={data}
                            panel={panel}
                            error={feedback.rowErrors[entry.item.id]}
                            memberError={memberErrors[entry.item.id] ?? null}
                            pending={pending}
                            onToggle={toggle}
                            onRename={rename}
                            onDelete={remove}
                            onAdd={addMember}
                            onRemove={removeMember}
                          />
                        ),
                      )}
                    </DataList>
                  </DataListSection>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Page>
  );
}

type GroupRowProps = {
  group: AdminGroup;
  data: Data;
  panel: RowPanel;
  error?: string;
  memberError: { text: string; n: number } | null;
  pending: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onRename: (group: AdminGroup, name: string) => Promise<void>;
  onDelete: (group: AdminGroup) => Promise<void>;
  onAdd: (group: AdminGroup, user: AdminUser) => Promise<void>;
  onRemove: (group: AdminGroup, user: AdminUser, neighbours: { next?: string; previous?: string }) => Promise<void>;
};

function GroupRow({ group, data, panel, error, memberError, pending, onToggle, onRename, onDelete, onAdd, onRemove }: GroupRowProps) {
  const m = useStrings();
  const s = m.groups;
  const id = `group-${group.id}`;
  const name = displayName(group, m);
  const used = group.categories + group.links > 0;
  const locked = group.source === "local" && lockedByFile(group, data.catalog);
  const membersOpen = panel.isOpen(`members:${group.id}`);
  const renaming = panel.isOpen(`rename:${group.id}`);
  const deleting = panel.isOpen(`delete:${group.id}`);
  const system = group.source === "system" ? (s.system as Record<string, { description: string } | undefined>)[group.name] : undefined;

  /** Open a panel unless CATALOG_FILE locks the group: the button then only says why. */
  const lockable = (key: string) => () => {
    if (!locked) onToggle(key);
  };

  return (
    <DataRow
      titleId={`${id}-title`}
      title={
        group.source === "system" ? (
          <>
            {name} <code className="font-mono text-sm font-normal text-muted-foreground">@{group.name}</code>
          </>
        ) : (
          name
        )
      }
      badges={
        group.source !== "system" && (
          <Badge variant="outline">
            {group.source === "local" ? <Users aria-hidden="true" /> : <Building2 aria-hidden="true" />}
            {s.source[group.source]}
          </Badge>
        )
      }
      meta={
        <>
          {system && <p>{system.description}</p>}
          {group.source !== "system" && <p>{s.members(group.memberIds.length)}</p>}
          {group.source === "oidc" && <p>{s.oidcSynced}</p>}
          <p>{used ? s.usage(group.categories, group.links) : s.unused}</p>
          {used && group.categories === 0 && <p>{s.onlyLinks}</p>}
          {used && group.links === 0 && <p>{s.onlyCategories}</p>}
          {locked && <p id={`${id}-locked`}>{s.managedByFile}</p>}
        </>
      }
      actions={
        group.source !== "system" && (
          <>
            <Button
              id={`${id}-members`}
              size="sm"
              variant="outline"
              aria-label={s.membersLabel(group.name, group.memberIds.length)}
              aria-expanded={membersOpen}
              aria-controls={membersOpen ? `${id}-panel` : undefined}
              onClick={() => onToggle(`members:${group.id}`)}
            >
              {s.membersButton(group.memberIds.length)}
            </Button>
            {group.source === "local" && (
              <>
                <Button
                  id={`${id}-rename`}
                  size="sm"
                  variant="outline"
                  aria-label={s.renameLabel(group.name)}
                  aria-expanded={renaming}
                  aria-controls={renaming ? `${id}-panel` : undefined}
                  aria-disabled={locked || undefined}
                  aria-describedby={locked ? `${id}-locked` : undefined}
                  onClick={lockable(`rename:${group.id}`)}
                >
                  {s.rename}
                </Button>
                <Button
                  id={`${id}-delete`}
                  size="sm"
                  variant="destructive-ghost"
                  aria-label={s.deleteLabel(group.name)}
                  aria-disabled={locked || undefined}
                  aria-describedby={locked ? `${id}-locked` : undefined}
                  onClick={lockable(`delete:${group.id}`)}
                >
                  {m.admin.delete}
                </Button>
              </>
            )}
          </>
        )
      }
      error={error}
      panel={
        (membersOpen || renaming || deleting) && (
          <div id={`${id}-panel`}>
            {membersOpen && <MembersPanel group={group} users={data.users} error={memberError} pending={pending} onAdd={onAdd} onRemove={onRemove} />}
            {renaming && (
              <GroupNameForm
                id={`${id}-form`}
                label={s.renameTitle(group.name)}
                submitLabel={m.admin.save}
                pendingLabel={m.admin.saving}
                initial={group.name}
                onSubmit={(next) => onRename(group, next)}
                onCancel={panel.cancel}
              />
            )}
            {deleting && (
              <ConfirmPanel
                question={s.deleteQuestion(group.name)}
                confirmLabel={m.admin.confirmDelete}
                pendingLabel={m.admin.deleting}
                onConfirm={() => onDelete(group)}
                onCancel={panel.cancel}
                errorText={(err) => adminErrorText(err, m)}
              >
                <p>{s.deleteDetails}</p>
                {used && <p>{s.deleteCatalogNotice(group.categories, group.links)}</p>}
              </ConfirmPanel>
            )}
          </div>
        )
      }
    />
  );
}

type MembersPanelProps = {
  group: AdminGroup;
  users: AdminUser[];
  error: { text: string; n: number } | null;
  pending: ReadonlySet<string>;
  onAdd: GroupRowProps["onAdd"];
  onRemove: GroupRowProps["onRemove"];
};

/**
 * List the members of a group, with a filter past ten. A local group removes a member in one click and adds people
 * from a picker; an OIDC group is read-only, its membership coming from the provider. When it opens, its first
 * field takes the focus; a panel without a field (a small OIDC group) leaves it on its trigger.
 */
function MembersPanel({ group, users, error, pending, onAdd, onRemove }: MembersPanelProps) {
  const m = useStrings();
  const s = m.groups;
  const id = `group-${group.id}`;
  const local = group.source === "local";
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>("input");
    if (!first) return;
    first.focus();
    claimFocus();
  }, []);
  const memberIds = useMemo(() => new Set(group.memberIds), [group.memberIds]);
  const members = useMemo(() => users.filter((u) => memberIds.has(u.id)), [users, memberIds]);
  const shown = members.length > MEMBER_FILTER_FROM ? members.filter((u) => matchesFilter(query, u.name, u.email)) : members;

  return (
    <div ref={ref} className="flex flex-col gap-4">
      {error && (
        <Alert key={error.n} variant="destructive" autoFocus>
          {error.text}
        </Alert>
      )}
      {!local && <p className="text-sm">{s.oidcMembers}</p>}
      {members.length === 0 ? (
        <p className="text-sm">{s.noMembers}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {members.length > MEMBER_FILTER_FROM && (
            <div className="flex max-w-sm flex-col gap-1.5">
              <Label htmlFor={`${id}-member-filter`}>{s.filterMembers}</Label>
              <Input id={`${id}-member-filter`} type="search" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={clearOnEscape(query, setQuery)} />
            </div>
          )}
          {shown.length === 0 ? (
            <p className="text-sm">{s.noMemberMatch}</p>
          ) : (
            <ul aria-label={s.membersOf(group.name)} className="flex flex-col divide-y divide-border rounded-lg border bg-background">
              {shown.map((user, i) => (
                <li key={user.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold wrap-anywhere">{user.name}</p>
                    <p className="text-sm wrap-anywhere text-muted-foreground">{user.email}</p>
                  </div>
                  {local && (
                    <PendingButton
                      id={removeButtonId(group.id, user.id)}
                      variant="destructive-ghost"
                      // Icon only, until its progress text needs the room.
                      size={pending.has(`${group.id}:${user.id}`) ? "sm" : "icon"}
                      className={pending.has(`${group.id}:${user.id}`) ? undefined : "size-9"}
                      aria-label={s.removeMember(user.name, group.name)}
                      pending={pending.has(`${group.id}:${user.id}`)}
                      pendingLabel={s.removing}
                      onClick={() => void onRemove(group, user, { next: shown[i + 1]?.id, previous: shown[i - 1]?.id })}
                    >
                      <UserMinus aria-hidden="true" />
                    </PendingButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {local && <MemberPicker group={group} users={users} memberIds={memberIds} pending={pending} onAdd={onAdd} />}
    </div>
  );
}

/** Return the key handler of a search field: Escape clears text there, and goes on to the page when it is empty. */
function clearOnEscape(query: string, setQuery: (query: string) => void) {
  return (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Escape" || query === "") return;
    e.preventDefault();
    e.stopPropagation();
    setQuery("");
  };
}

type MemberPickerProps = {
  group: AdminGroup;
  users: AdminUser[];
  memberIds: ReadonlySet<string>;
  pending: ReadonlySet<string>;
  onAdd: GroupRowProps["onAdd"];
};

/**
 * Offer the people who are not members yet, at most eight at a time, each with an Add button; the search narrows
 * them by name or e-mail. The list stays in the page flow (no popup), so it works the same with a screen reader.
 */
function MemberPicker({ group, users, memberIds, pending, onAdd }: MemberPickerProps) {
  const m = useStrings();
  const s = m.groups;
  const id = pickerId(group.id);
  const [query, setQuery] = useState("");
  // Folded once per load of the users, so it holds for thousands of accounts.
  const filter = useMemo(() => prepareFilter(users, (u) => [u.name, u.email]), [users]);
  const candidates = useMemo(() => users.filter((u) => !memberIds.has(u.id)), [users, memberIds]);
  const matches = useMemo(() => filter(query).filter((u) => !memberIds.has(u.id)), [filter, query, memberIds]);
  const shown = matches.slice(0, PICKER_LIMIT);
  const status =
    candidates.length === 0
      ? s.everyoneIsMember
      : matches.length === 0
        ? s.pickerNone
        : matches.length > PICKER_LIMIT
          ? s.pickerMore(matches.length, PICKER_LIMIT)
          : s.pickerCount(matches.length);
  useDebouncedStatus(query, status);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex max-w-sm flex-col gap-1.5">
        <Label htmlFor={id}>{s.addPeople}</Label>
        <Input
          id={id}
          type="search"
          autoComplete="off"
          aria-describedby={`${id}-status`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={clearOnEscape(query, setQuery)}
        />
      </div>
      <p id={`${id}-status`} className="text-sm text-muted-foreground">
        {status}
      </p>
      {shown.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border bg-background">
          {shown.map((user) => (
            <li key={user.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold wrap-anywhere">{user.name}</p>
                <p className="text-sm wrap-anywhere text-muted-foreground">{user.email}</p>
              </div>
              <PendingButton
                size="sm"
                variant="outline"
                aria-label={s.addPersonLabel(user.name, group.name)}
                pending={pending.has(`${group.id}:${user.id}`)}
                pendingLabel={s.adding}
                onClick={() => void onAdd(group, user)}
              >
                {s.addPerson}
              </PendingButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type GroupNameFormProps = {
  id: string;
  label: string;
  submitLabel: string;
  pendingLabel: string;
  initial: string;
  /** Save the name; a rejection shows its error, on the field when it is about the name. */
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
};

/** Ask for a group name, to create or rename one; the field opens filled in and selected. */
function GroupNameForm({ id, label, submitLabel, pendingLabel, initial, onSubmit, onCancel }: GroupNameFormProps) {
  const m = useStrings();
  const errors = useFormErrors(["name"] as const, id);
  const [name, setName] = useState(initial);
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!errors.check({ name: name.trim() === "" && m.fieldErrors.required })) return;
    setPending(true);
    try {
      await onSubmit(name);
    } catch (err) {
      errors.failWith(err, { fallback: adminErrorText });
    } finally {
      setPending(false);
    }
  }

  return (
    <InlineForm id={id} aria-label={label} onSubmit={submit} onCancel={onCancel} className="max-w-md">
      <FormStack>
        <ErrorSummary errors={errors} labels={{ name: m.groups.name }} />
        <Field ref={input} {...errors.field("name")} label={m.groups.name} required autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        <FormActions>
          <SubmitButton pending={pending} pendingLabel={pendingLabel}>
            {submitLabel}
          </SubmitButton>
          <Button type="button" variant="outline" onClick={onCancel}>
            {m.admin.cancel}
          </Button>
        </FormActions>
      </FormStack>
    </InlineForm>
  );
}
