import { Pencil, Trash2 } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

import { type AdminCategory, type AdminGroup, type AdminUser, api } from "../../../api";
import { AdminShell } from "../../../components/admin/AdminShell";
import { ConfirmPanel } from "../../../components/admin/ConfirmPanel";
import { DetailColumns, listHref, PaneDanger, PaneSection } from "../../../components/admin/DetailPage";
import { CheckList } from "../../../components/admin/Wizard";
import { StateMark } from "../../../components/admin/StateMark";
import { ErrorSummary } from "../../../components/form/ErrorSummary";
import { Field } from "../../../components/form/Field";
import { FormActions, FormStack } from "../../../components/form/FormLayout";
import { SubmitButton } from "../../../components/form/PendingButton";
import { Link } from "../../../components/Link";
import { Alert } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { useStrings } from "../../../i18n/LocaleProvider";
import { useAdminCollection } from "../../../lib/admin-collection";
import { useAnnounce } from "../../../lib/announcer";
import { focusById } from "../../../lib/focus";
import { useFormErrors } from "../../../lib/form-errors";
import { groupRefOf, neverReceived } from "../../../lib/group-ref";
import { invalidateHome } from "../../../lib/home-store";
import { categoryHref, linkHref } from "../links/item-edit";
import { adminErrorText } from "../shared";

const LIST = "/admin/users";
const ITEM_LINK =
  "inline-flex min-h-11 items-center underline decoration-link-decoration decoration-2 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden";

/** Return the name a group shows: built-in groups with their `@`, as the catalog cites them. */
export function groupName(group: AdminGroup): string {
  return group.source === "system" ? `@${group.name}` : group.name;
}

/**
 * Add and remove the members of a group, one request each; `pending` maps the people whose request runs to the state
 * asked for, shown at once so the box follows the click (`shownMembers`) and put back if the request fails. A success
 * is announced, a failure shown by `error` (give it to an Alert keyed by `n`, so it is read again).
 */
export function useMembership(group: AdminGroup, onMembership: (user: AdminUser, member: boolean) => void) {
  const m = useStrings();
  const announce = useAnnounce();
  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [error, setError] = useState<{ text: string; n: number } | null>(null);
  async function change(user: AdminUser, member: boolean) {
    setPending((prev) => new Map(prev).set(user.id, member));
    setError(null);
    try {
      if (member) await api.addMember(group.id, user.id);
      else await api.removeMember(group.id, user.id);
      onMembership(user, member);
      invalidateHome();
      announce(member ? m.groups.added(user.name, group.name) : m.groups.removed(user.name, group.name));
    } catch (err) {
      setError((prev) => ({ text: adminErrorText(err, m), n: (prev?.n ?? 0) + 1 }));
    } finally {
      setPending((prev) => {
        const next = new Map(prev);
        next.delete(user.id);
        return next;
      });
    }
  }
  return { pending, error, change };
}

/** The members as the boxes show them: the stored ones, with the requests still running applied. */
export function shownMembers(memberIds: readonly string[], pending: ReadonlyMap<string, boolean>): Set<string> {
  const shown = new Set(memberIds);
  for (const [id, member] of pending) {
    if (member) shown.add(id);
    else shown.delete(id);
  }
  return shown;
}

/** Return what a group opens, from the catalog as stored: the categories and the links that cite it. */
export function opensOf(group: AdminGroup, catalog: AdminCategory[] | null) {
  if (!catalog) return null;
  const ref = groupRefOf(group);
  return {
    categories: catalog.filter((c) => c.groups.includes(ref)),
    links: catalog.flatMap((c) => c.links.filter((l) => l.groups.includes(ref)).map((l) => ({ ...l, category: c.title }))),
  };
}

type GroupPageProps = {
  group: AdminGroup;
  users: AdminUser[];
  /** A membership the server confirmed. */
  onMembership: (user: AdminUser, member: boolean) => void;
  onRenamed: (group: AdminGroup) => void;
  onDeleted: () => void;
};

/** Page of a group: members at the left, what it opens at the right, rename and delete at the bottom for a local group. */
export function GroupPage({ group, users, onMembership, onRenamed, onDeleted }: GroupPageProps) {
  const m = useStrings();
  const s = m.groups;
  const catalog = useAdminCollection(api.categories);
  const state = useAdminCollection(api.catalogState);
  const [confirm, setConfirm] = useState<"rename" | "delete" | null>(null);
  // A closed form or confirmation gives the focus back to the button that opened it.
  const back = (trigger: "rename" | "delete") => {
    setConfirm(null);
    void focusById(`group-${trigger}`);
  };
  const { pending, error, change } = useMembership(group, onMembership);
  const local = group.source === "local";
  const usedByFile = (state.data?.managedByFile ?? false) && group.categories + group.links > 0;
  const memberIds = new Set(group.memberIds);
  const members = users.filter((u) => memberIds.has(u.id));
  const opens = useMemo(() => opensOf(group, catalog.data), [group, catalog.data]);

  return (
    <AdminShell
      section="users"
      title={groupName(group)}
      back={{ href: listHref(LIST), label: m.admin.backTo(m.users.title) }}
      subtitle={
        <>
          <p>{s.originSentence[group.source]}</p>
          {neverReceived(group) && <StateMark tone="warning" className="text-base text-foreground">{s.neverReceived}</StateMark>}
        </>
      }
    >
      <DetailColumns
        main={
          <PaneSection title={s.membersTitle}>
            {group.source === "system" ? (
              <p>{s.system[group.name as "everyone" | "authenticated"]?.description}</p>
            ) : local ? (
              <>
                <CheckList
                  legend={s.membersTitle}
                  items={users}
                  labelOf={(u) => u.name}
                  hintOf={(u) => u.email}
                  checked={shownMembers(group.memberIds, pending)}
                  busy={new Set(pending.keys())}
                  onToggle={(user, member) => void change(user, member)}
                />
                {error && (
                  <Alert key={error.n} variant="destructive" autoFocus>
                    {error.text}
                  </Alert>
                )}
              </>
            ) : members.length === 0 ? (
              <p className="text-muted-foreground">{s.noMembers}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border border-y border-border">
                {members.map((user) => (
                  <li key={user.id} className="flex min-h-12 flex-col justify-center py-1">
                    <p className="wrap-anywhere">
                      <Link href={`/admin/users/${encodeURIComponent(user.id)}`} className="hover:underline hover:decoration-link-decoration hover:decoration-2 hover:underline-offset-4">
                        {user.name}
                      </Link>
                      {user.disabled && <StateMark tone="destructive" className="ml-2 align-top">{m.users.states.disabled}</StateMark>}
                    </p>
                    <p className="truncate text-[0.8125rem] text-muted-foreground">{user.email}</p>
                  </li>
                ))}
              </ul>
            )}
          </PaneSection>
        }
        side={
          <PaneSection title={s.opensTitle}>
            {catalog.status === "error" ? (
              <p className="text-sm">{s.opensLoadError}</p>
            ) : !opens ? (
              <p className="text-sm text-muted-foreground">{m.loading}</p>
            ) : opens.categories.length + opens.links.length === 0 ? (
              <p className="text-sm text-muted-foreground">{s.opensNone}</p>
            ) : (
              <div className="flex flex-col gap-4">
                {opens.categories.length > 0 && (
                  <div>
                    <p className="mb-1 text-sm text-muted-foreground">{s.opensCategories}</p>
                    <ul className="flex flex-col">
                      {opens.categories.map((c) => (
                        <li key={c.id}>
                          <Link href={categoryHref(c.id)} className={ITEM_LINK}>
                            {c.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {opens.links.length > 0 && (
                  <div>
                    <p className="mb-1 text-sm text-muted-foreground">{s.opensLinks}</p>
                    <ul className="flex flex-col">
                      {opens.links.map((l) => (
                        <li key={l.id}>
                          <Link href={linkHref(l.id)} className={ITEM_LINK}>
                            {l.title}
                          </Link>
                          <span className="ml-2 text-sm text-muted-foreground">{l.category}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </PaneSection>
        }
        danger={
          local && (
            <PaneDanger>
              {usedByFile && (
                <p id={`group-${group.id}-blocked`} className="text-sm text-muted-foreground">
                  {s.deleteBlocked}
                </p>
              )}
              {confirm === "rename" ? (
                <RenameForm
                  group={group}
                  onCancel={() => back("rename")}
                  onRenamed={(g) => {
                    back("rename");
                    onRenamed(g);
                  }}
                />
              ) : confirm === "delete" ? (
                <ConfirmPanel
                  question={s.deleteQuestion(group.name)}
                  confirmLabel={m.admin.confirmDelete}
                  pendingLabel={m.admin.deleting}
                  onConfirm={async () => {
                    await api.deleteGroup(group.id);
                    onDeleted();
                  }}
                  onCancel={() => back("delete")}
                  errorText={(err) => adminErrorText(err, m)}
                >
                  <p>{s.deleteDetails}</p>
                  {group.categories + group.links > 0 && <p>{s.deleteCatalogNotice(group.categories, group.links)}</p>}
                </ConfirmPanel>
              ) : (
                <div className="flex flex-wrap gap-3">
                  <Button
                    id="group-rename"
                    variant="outline"
                    aria-disabled={usedByFile || undefined}
                    aria-describedby={usedByFile ? `group-${group.id}-blocked` : undefined}
                    onClick={() => !usedByFile && setConfirm("rename")}
                  >
                    <Pencil aria-hidden="true" />
                    {s.rename}
                  </Button>
                  <Button
                    id="group-delete"
                    variant="destructive-ghost"
                    aria-disabled={usedByFile || undefined}
                    aria-describedby={usedByFile ? `group-${group.id}-blocked` : undefined}
                    onClick={() => !usedByFile && setConfirm("delete")}
                  >
                    <Trash2 aria-hidden="true" />
                    {s.deleteLabel(group.name)}
                  </Button>
                </div>
              )}
            </PaneDanger>
          )
        }
      />
    </AdminShell>
  );
}

/** Ask for the new name of a group, the field filled in. */
function RenameForm({ group, onCancel, onRenamed }: { group: AdminGroup; onCancel: () => void; onRenamed: (group: AdminGroup) => void }) {
  const m = useStrings();
  const s = m.groups;
  const errors = useFormErrors<"name">(["name"], `group-${group.id}-rename`);
  const [name, setName] = useState(group.name);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!errors.check({ name: name.trim() === "" && m.fieldErrors.required })) return;
    setPending(true);
    try {
      const { group: renamed } = await api.renameGroup(group.id, name);
      onRenamed(renamed);
    } catch (err) {
      errors.failWith(err, { fallback: adminErrorText });
      setPending(false);
    }
  }

  return (
    <form
      id={`group-${group.id}-rename`}
      noValidate
      aria-label={s.renameTitle(group.name)}
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        onCancel();
      }}
    >
      <FormStack className="gap-4">
        <ErrorSummary errors={errors} labels={{ name: s.name }} />
        <Field {...errors.field("name")} label={s.name} autoFocus required autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        <FormActions>
          <SubmitButton pending={pending} pendingLabel={m.admin.saving}>
            {m.admin.save}
          </SubmitButton>
          <Button type="button" variant="outline" onClick={onCancel}>
            {m.admin.cancel}
          </Button>
        </FormActions>
      </FormStack>
    </form>
  );
}
