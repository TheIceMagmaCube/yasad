import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { type AdminGroup, type AdminUser, api, type User } from "../../../api";
import { AdminShell, AdminToolbar } from "../../../components/admin/AdminShell";
import { AdminTable, type Column, RowLink } from "../../../components/admin/AdminTable";
import { listHref, rememberRow, useQueryState, useRestoreRow } from "../../../components/admin/DetailPage";
import { StateMark } from "../../../components/admin/StateMark";
import { EmptyState } from "../../../components/EmptyState";
import { Link } from "../../../components/Link";
import { LoadError } from "../../../components/LoadError";
import { Alert } from "../../../components/ui/alert";
import { Button, buttonVariants } from "../../../components/ui/button";
import { NativeSelect } from "../../../components/ui/native-select";
import type { Messages } from "../../../i18n/en";
import { useLocale, useStrings } from "../../../i18n/LocaleProvider";
import { useAdminCollection } from "../../../lib/admin-collection";
import { useListFeedback } from "../../../lib/admin-list";
import { prepareFilter } from "../../../lib/filter";
import { focusById } from "../../../lib/focus";
import { neverReceived } from "../../../lib/group-ref";
import { invalidateHome } from "../../../lib/home-store";
import { formatRelative } from "../../../lib/relative-time";
import { navigate } from "../../../lib/router";
import { AddPeople } from "./AddPeople";
import { GroupPage, groupName } from "./GroupPage";
import { PersonPage } from "./PersonPage";

const LIST = "/admin/users";
const FILTER_ID = "users-filter";
export const personHref = (id: string) => `${LIST}/${encodeURIComponent(id)}`;
export const groupHref = (id: string) => `/admin/groups/${encodeURIComponent(id)}`;
const linkIdOf = (id: string) => `user-${id}-link`;

/** States the dashboard links to, as `?state=`. */
const STATES = {
  temporary: (u: AdminUser) => u.mustChangePassword,
  disabled: (u: AdminUser) => u.disabled,
} as const;
type StateFilter = keyof typeof STATES;
const isState = (value: string): value is StateFilter => Object.hasOwn(STATES, value);

/** Return the first two group names of a person, and how many more there are. */
function groupsCell(user: AdminUser, m: Messages) {
  if (user.groups.length === 0) return <span className="text-muted-foreground">-</span>;
  const shown = user.groups.slice(0, 2).map((g) => g.name);
  const more = user.groups.length - shown.length;
  return (
    <span>
      {shown.join(", ")}
      {more > 0 && <span className="ml-1.5 text-muted-foreground">{m.users.more(more)}</span>}
    </span>
  );
}

/** Return the one mark of an abnormal account, disabled first; none when all is well. */
function stateOf(user: AdminUser, m: Messages) {
  if (user.disabled) return <StateMark tone="destructive">{m.users.states.disabled}</StateMark>;
  if (user.mustChangePassword) return <StateMark tone="warning">{m.users.states.temporary}</StateMark>;
  return null;
}

export type PeopleRoute = { kind: "person" | "group"; id: string } | null;

/**
 * Admin section of people and their groups: the people table, narrowed to a group when one is chosen, the pages of
 * a person or a group, and the wizard adding either. One component for all of them, so the loaded data, the filter
 * and the temporary passwords not noted yet stay while going from the list to a page and back.
 */
export function PeoplePage({ me, open }: { me: User; open: PeopleRoute }) {
  const m = useStrings();
  const s = m.users;
  const { language } = useLocale();
  const users = useAdminCollection(api.users);
  const groups = useAdminCollection(api.groups);
  const catalog = useAdminCollection(api.categories);
  const state = useAdminCollection(api.catalogState);
  const feedback = useListFeedback();
  const [query, setQuery] = useQueryState("q");
  const [groupId, setGroupId] = useQueryState("group");
  const [stateFilter, setStateFilter] = useQueryState("state");
  // Temporary passwords not noted yet, by person: shown on their page, and recalled above the table meanwhile.
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [now] = useState(() => Date.now());

  const list = users.data;
  const groupList = groups.data;
  const filterGroups = useMemo(
    () => (groupList ?? []).filter((g) => g.source !== "system").sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    [groupList],
  );
  const selected = filterGroups.find((g) => g.id === groupId) ?? null;
  const filter = useMemo(() => prepareFilter(list ?? [], (u) => [u.name, u.email]), [list]);
  const shown = useMemo(() => {
    let rows = filter(query);
    if (selected) rows = rows.filter((u) => selected.memberIds.includes(u.id));
    if (isState(stateFilter)) rows = rows.filter(STATES[stateFilter]);
    return rows;
  }, [filter, query, selected, stateFilter]);
  const shownRef = useRef(shown);
  useEffect(() => {
    shownRef.current = shown;
  });
  useRestoreRow(LIST, open === null && list !== null);

  const changeQuery = (next: string) => {
    setQuery(next);
    feedback.clearForFilter();
  };
  const replaceUser = (updated: AdminUser) => users.setData((all) => all.map((u) => (u.id === updated.id ? updated : u)));
  const setMembers = (group: AdminGroup, memberIds: string[]) => {
    groups.setData((all) => all.map((g) => (g.id === group.id ? { ...g, memberIds } : g)));
    users.setData((all) =>
      all.map((u) => {
        const member = memberIds.includes(u.id);
        const has = u.groups.some((g) => g.id === group.id);
        if (member === has) return u;
        return { ...u, groups: member ? [...u.groups, { id: group.id, name: group.name, source: group.source }] : u.groups.filter((g) => g.id !== group.id) };
      }),
    );
  };
  const dropSecret = (id: string) =>
    setSecrets((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  // Item pages.
  if (open && (!list || !groupList)) {
    return (
      <AdminShell section="users" title={m.loading}>
        {users.status === "error" ? <LoadError attempt={users.attempt} message={s.loadError} pending={users.retrying} onRetry={users.retry} /> : null}
      </AdminShell>
    );
  }
  if (open?.kind === "person" && list && groupList) {
    if (open.id === "new") {
      return (
        <AdminShell section="users" title={m.admin.add} back={{ href: listHref(LIST), label: m.admin.backTo(s.title) }}>
          <AddPeople
            users={list}
            groups={groupList}
            initialType={new URLSearchParams(location.search).get("type") === "group" ? "group" : "person"}
            onPersonCreated={(user) => {
              users.setData((all) => [...all.filter((u) => u.id !== user.id), user]);
              void groups.refresh();
              invalidateHome();
            }}
            onGroupCreated={(group) => {
              groups.setData((all) => [...all, group]);
              void users.refresh();
              invalidateHome();
            }}
            onDone={(text, linkId) => {
              feedback.say(text);
              rememberRow(LIST, linkId);
              navigate(listHref(LIST));
            }}
          />
        </AdminShell>
      );
    }
    const user = list.find((u) => u.id === open.id);
    if (!user) return <Missing />;
    return (
      <PersonPage
        key={user.id}
        user={user}
        self={user.id === me.id}
        localGroups={groupList.filter((g) => g.source === "local")}
        secret={secrets[user.id] ?? null}
        onUpdated={(updated, text) => {
          replaceUser(updated);
          feedback.say(text);
        }}
        onMembership={(group, member) =>
          setMembers(group, member ? [...new Set([...group.memberIds, user.id])] : group.memberIds.filter((id) => id !== user.id))
        }
        onSecret={(password) => setSecrets((prev) => ({ ...prev, [user.id]: password }))}
        onNoted={() => dropSecret(user.id)}
        onDeleted={() => {
          feedback.bury({ id: user.id, text: s.deleted(user.name), variant: "success", index: Math.max(0, shownRef.current.findIndex((u) => u.id === user.id)) });
          dropSecret(user.id);
          users.setData((all) => all.filter((u) => u.id !== user.id));
          navigate(listHref(LIST));
          void users.refresh();
        }}
      />
    );
  }
  if (open?.kind === "group" && list && groupList) {
    const group = groupList.find((g) => g.id === open.id);
    if (!group) return <Missing />;
    return (
      <GroupPage
        key={group.id}
        group={group}
        users={list}
        catalog={catalog.data}
        catalogFailed={catalog.status === "error"}
        managedByFile={state.data?.managedByFile ?? false}
        onMembers={(memberIds) => setMembers(group, memberIds)}
        onRenamed={(renamed) => {
          groups.setData((all) => all.map((g) => (g.id === renamed.id ? renamed : g)));
          void users.refresh();
          feedback.say(m.groups.renamed(renamed.name));
          invalidateHome();
        }}
        onDeleted={() => {
          groups.setData((all) => all.filter((g) => g.id !== group.id));
          void users.refresh();
          invalidateHome();
          if (groupId === group.id) setGroupId("");
          feedback.say(m.groups.deleted(group.name));
          navigate(LIST);
          void focusById(FILTER_ID);
        }}
      />
    );
  }

  const columns: Column<AdminUser>[] = [
    {
      id: "name",
      header: s.columns.name,
      sortValue: (u) => u.name,
      cell: (u) => (
        <div className="flex min-w-0 flex-col">
          <span className="wrap-anywhere @min-[40rem]/table:whitespace-nowrap">
            <RowLink id={linkIdOf(u.id)} href={personHref(u.id)} listBase={LIST}>
              {u.name}
            </RowLink>
            {u.id === me.id && <span className="ml-1.5 text-muted-foreground">{s.you}</span>}
          </span>
          <span className="truncate text-[0.8125rem] text-muted-foreground @min-[40rem]/table:hidden">{u.email}</span>
        </div>
      ),
      className: "w-full max-w-0 @min-[40rem]/table:w-auto @min-[40rem]/table:max-w-none",
    },
    {
      id: "email",
      header: s.columns.email,
      cell: (u) => <span className="block max-w-[15rem] truncate text-muted-foreground">{u.email}</span>,
      className: "hidden @min-[40rem]/table:table-cell",
    },
    {
      id: "groups",
      header: s.columns.groups,
      cell: (u) => groupsCell(u, m),
      className: "hidden whitespace-nowrap @min-[56rem]/table:table-cell",
    },
    {
      id: "lastSignIn",
      header: s.columns.lastSignIn,
      sortValue: (u) => (u.lastSignInAt ? Date.parse(u.lastSignInAt) : 0),
      cell: (u) => {
        const { text, exact } = formatRelative(u.lastSignInAt, language, m, now);
        return (
          <div className="flex flex-col items-end gap-1 @min-[40rem]/table:items-start">
            {u.lastSignInAt ? (
              <time dateTime={u.lastSignInAt} title={exact ?? undefined} className="text-sm tabular-nums whitespace-nowrap">
                {text}
              </time>
            ) : (
              <span className="text-sm text-muted-foreground">{text}</span>
            )}
            <span className="text-right whitespace-nowrap @min-[40rem]/table:hidden">{stateOf(u, m) ?? (u.role === "admin" && <span className="text-muted-foreground">{s.adminWord}</span>)}</span>
          </div>
        );
      },
      className: "w-44 text-right @min-[40rem]/table:w-auto @min-[40rem]/table:text-left",
    },
    {
      id: "state",
      header: s.columns.state,
      cell: (u) => stateOf(u, m) ?? (u.role === "admin" ? <span className="text-muted-foreground">{s.adminWord}</span> : null),
      className: "hidden whitespace-nowrap @min-[40rem]/table:table-cell",
    },
  ];

  const pending = Object.keys(secrets);
  const filtering = query.trim() !== "" || isState(stateFilter) || selected !== null;
  const count = !list ? "" : filtering ? s.countFiltered(shown.length, list.length) : s.count(list.length);

  return (
    <AdminShell section="users">
      {users.status === "error" ? (
        <LoadError attempt={users.attempt} message={s.loadError} pending={users.retrying} onRetry={users.retry} />
      ) : (
        <>
          <AdminToolbar
            filterId={FILTER_ID}
            filterLabel={s.filter}
            query={query}
            onQueryChange={changeQuery}
            count={count}
            status={feedback.status}
            filters={
              <div className="flex items-center gap-2">
                <label htmlFor="users-group" className="text-sm font-semibold">
                  {s.groupFilterLabel}
                </label>
                <NativeSelect
                  id="users-group"
                  className="w-48"
                  value={selected?.id ?? ""}
                  onChange={(e) => {
                    setGroupId(e.target.value);
                    feedback.clearForFilter();
                  }}
                >
                  <option value="">{s.allGroups}</option>
                  {filterGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.memberIds.length}){neverReceived(g) ? `, ${m.links.unknownMembers}` : ""}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            }
            actions={
              <Link id="users-new" href={`${LIST}/new`} className={buttonVariants()} onClick={() => rememberRow(LIST, "users-new")}>
                <Plus aria-hidden="true" />
                {m.admin.add}
              </Link>
            }
          />
          {isState(stateFilter) && (
            <p className="mb-4 flex flex-wrap items-center gap-x-3 text-sm">
              <span>
                {m.admin.filtered} {s.states[stateFilter]}
              </span>
              <button
                type="button"
                onClick={() => setStateFilter("")}
                className="inline-flex min-h-11 items-center underline decoration-link-decoration decoration-2 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {m.admin.attentionClear}
              </button>
            </p>
          )}
          {selected && (
            <div data-slot="group-line" className="mb-4 flex flex-wrap items-center gap-x-4 border-l-4 border-selected py-1 pl-4">
              <p className="mr-auto">
                <span className="font-bold">{groupName(selected)}</span>
                <span className="text-muted-foreground"> · {s.groupLine(selected.memberIds.length, m.groups.opens(selected.categories, selected.links))}</span>
              </p>
              <Link
                id="group-manage"
                href={groupHref(selected.id)}
                onClick={() => rememberRow(LIST, "group-manage")}
                className="inline-flex min-h-11 items-center text-sm font-bold underline decoration-link-decoration decoration-2 underline-offset-4 hover:decoration-foreground"
              >
                {s.manageGroup}
              </Link>
            </div>
          )}
          {pending.map((id) => {
            const user = list?.find((u) => u.id === id);
            return (
              user && (
                <Alert key={id} variant="warning" className="mb-4">
                  {s.pendingSecret(user.name)}{" "}
                  <Link href={personHref(id)} className="font-bold underline decoration-2 underline-offset-4">
                    {s.showSecret}
                  </Link>
                </Alert>
              )
            );
          })}
          {users.refreshFailures > 0 && (
            <Alert key={users.refreshFailures} variant="warning" className="mb-4">
              {m.admin.refreshFailed}
            </Alert>
          )}
          {!list ? (
            <div aria-hidden="true" className="appear-delayed h-64 rounded-(--radius-card) bg-muted motion-safe:animate-pulse" />
          ) : shown.length === 0 && feedback.tombstones.length === 0 ? (
            selected && !query.trim() && !isState(stateFilter) ? (
              <p className="py-4 text-muted-foreground">{s.noMembersInGroup}</p>
            ) : (
              <EmptyState
                title={m.admin.noMatch(query.trim())}
                actions={
                  <Button
                    variant="outline"
                    onClick={() => {
                      changeQuery("");
                      setStateFilter("");
                      setGroupId("");
                      void focusById(FILTER_ID);
                    }}
                  >
                    {m.admin.clearFilter}
                  </Button>
                }
              />
            )
          ) : (
            <AdminTable
              caption={s.caption}
              columns={columns}
              sections={[{ id: "all", rows: shown }]}
              initialSort={{ column: "name", direction: "ascending" }}
              tombstones={feedback.tombstones}
            />
          )}
        </>
      )}
    </AdminShell>
  );
}

/** Page for an address whose item no longer exists. */
function Missing() {
  const m = useStrings();
  return (
    <AdminShell section="users" title={m.admin.errors.not_found} back={{ href: LIST, label: m.admin.backTo(m.users.title) }}>
      <p className="text-muted-foreground">{m.notFound.body}</p>
    </AdminShell>
  );
}
