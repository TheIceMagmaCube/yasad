import { Building2, Clock, KeyRound, Pencil, Trash2, UserPlus, Users } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { type AdminUser, api, type Role, type User, type UserChanges } from "../../api";
import { ConfirmPanel } from "../../components/admin/ConfirmPanel";
import { DataList, DataRow, ListSkeleton, TombstoneRow } from "../../components/admin/DataList";
import { SecretPanel } from "../../components/admin/SecretPanel";
import { Toolbar } from "../../components/admin/Toolbar";
import { EmptyState } from "../../components/EmptyState";
import { ErrorSummary } from "../../components/form/ErrorSummary";
import { Field } from "../../components/form/Field";
import { FormActions, FormStack } from "../../components/form/FormLayout";
import { InlineForm } from "../../components/form/InlineForm";
import { SubmitButton } from "../../components/form/PendingButton";
import { SelectField } from "../../components/form/SelectField";
import { LoadError } from "../../components/LoadError";
import { Page } from "../../components/Page";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { CheckboxField } from "../../components/ui/checkbox";
import { useLocale, useStrings } from "../../i18n/LocaleProvider";
import { useAdminCollection } from "../../lib/admin-collection";
import { focusIfLost, focusIsLost, focusIsWithin, rowHasFocus, type RowPanel, useListFeedback, useRowPanel, withTombstones } from "../../lib/admin-list";
import { useAnnounce } from "../../lib/announcer";
import { prepareFilter } from "../../lib/filter";
import { focusById } from "../../lib/focus";
import { useFormErrors } from "../../lib/form-errors";
import { AdminPageHeader } from "./AdminLayout";
import { adminErrorText, isNotFound, PersonTile } from "./shared";

const NEW = "new";
const FILTER_ID = "users-filter";

/** Return the id of the button that opens a panel: `new`, or `<kind>:<user id>` with kind edit, reset or delete. */
function userTrigger(key: string): string {
  if (key === NEW) return "users-new";
  const at = key.indexOf(":");
  return `user-${key.slice(at + 1)}-${key.slice(0, at)}`;
}

/** Return whether the focus is in the row of a row panel key (`<kind>:<id>`), or lost. */
const focusInRow = (key: string) => rowHasFocus(`user-${key.slice(key.indexOf(":") + 1)}-title`) || focusIsLost();

/**
 * A temporary password shown in its row until noted; `then` is the button that gets the focus once noted, `focus`
 * whether the panel takes the focus (not when the person had moved on before the request ended).
 */
type Secret = { userId: string; password: string; then: "edit" | "reset"; focus: boolean };

/** Admin page: list the accounts, create local ones, change, disable, reset or delete them. */
export function AdminUsers({ me }: { me: User }) {
  const m = useStrings();
  const s = m.users;
  const announce = useAnnounce();
  const collection = useAdminCollection(api.users);
  const feedback = useListFeedback();
  const panel = useRowPanel(userTrigger, feedback.pin);
  const [query, setQuery] = useState("");
  // One per person: a second reset or account never hides a password not noted yet.
  const [secrets, setSecrets] = useState<Record<string, Secret>>({});

  const users = collection.data;
  const filter = useMemo(() => prepareFilter(users ?? [], (u) => [u.name, u.email]), [users]);
  const matched = useMemo(() => new Set(filter(query).map((u) => u.id)), [filter, query]);
  // A row in the middle of something stays whatever the filter: its open panel, an error, a pin, or a temporary
  // password not noted yet.
  const shown = (users ?? []).filter((u) => matched.has(u.id) || feedback.kept.has(u.id) || Object.hasOwn(secrets, u.id) || panel.holds(u.id));
  // Read when a request ends, to put a tombstone where its row was.
  const shownRef = useRef(shown);
  useEffect(() => {
    shownRef.current = shown;
  });

  const changeQuery = (next: string) => {
    setQuery(next);
    feedback.clearForFilter();
  };

  /** Open a panel of a row, or the new user form, clearing what the previous action left. */
  const toggle = (key: string) => {
    feedback.clear();
    panel.toggle(key);
  };

  /**
   * After a success: close the panel that ran it and focus its trigger; if the person moved on (`stillOpen` false),
   * only say it.
   */
  const succeed = (stillOpen: () => boolean, key: string, text: string) => {
    const open = stillOpen();
    // The focus comes back to the trigger only from the row, not from the filter the person went on typing in.
    const here = open && focusInRow(key);
    if (open) panel.close();
    feedback.say(text, here ? focusById(userTrigger(key)) : undefined);
    if (!here) focusIfLost(userTrigger(key));
    void collection.refresh();
  };

  const putSecret = (secret: Secret) => setSecrets((prev) => ({ ...prev, [secret.userId]: secret }));
  const dropSecret = (userId: string) =>
    setSecrets((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });

  /**
   * Replace the row of a user the server no longer has by a message, then reload. The message takes the focus when
   * the focus is in the row (its panel, or its buttons after Cancel) or lost; elsewhere it is only announced.
   */
  const gone = (user: AdminUser, stillOpen: () => boolean, text = m.admin.errors.not_found, variant: "success" | "destructive" = "destructive") => {
    // Any panel of the row goes with it, opened again or not.
    if (stillOpen() || panel.holds(user.id)) panel.close();
    if (feedback.isBuried(user.id)) {
      // Already replaced and read: say nothing twice.
    } else if (rowHasFocus(`user-${user.id}-title`) || focusIsLost()) {
      feedback.bury({ id: user.id, text, variant, index: Math.max(0, shownRef.current.findIndex((u) => u.id === user.id)) });
    } else announce(text);
    dropSecret(user.id);
    collection.setData((list) => list.filter((u) => u.id !== user.id));
    void collection.refresh();
  };

  /** Report the failure of a row action: in its panel when still open (rethrown), else in the row. */
  const failed = (user: AdminUser, stillOpen: () => boolean, err: unknown) => {
    if (isNotFound(err)) return gone(user, stillOpen);
    if (stillOpen()) throw err;
    feedback.rowError(user.id, adminErrorText(err, m));
  };

  async function save(user: AdminUser, changes: UserChanges) {
    const key = `edit:${user.id}`;
    if (Object.keys(changes).length === 0) return panel.cancel();
    const stillOpen = panel.claim(key);
    try {
      const { user: updated } = await api.updateUser(user.id, changes);
      collection.setData((list) => list.map((u) => (u.id === updated.id ? updated : u)));
      feedback.pin(updated.id);
      succeed(stillOpen, key, s.edited(updated.name));
    } catch (err) {
      failed(user, stillOpen, err);
    }
  }

  async function create(input: { name: string; email: string; role: Role }) {
    const stillOpen = panel.claim(NEW);
    let created: Awaited<ReturnType<typeof api.createUser>>;
    try {
      created = await api.createUser(input);
    } catch (err) {
      if (stillOpen()) throw err;
      // The form is gone: say it under the toolbar, where it was; the alert is read as it appears.
      feedback.rowError(NEW, adminErrorText(err, m));
      return;
    }
    const { user, temporaryPassword } = created;
    const open = stillOpen();
    const here = open && focusIsWithin("users-new-panel");
    if (open) panel.close();
    // Its temporary password keeps the new row shown, whatever the filter.
    collection.setData((list) => [...list.filter((u) => u.id !== user.id), user]);
    putSecret({ userId: user.id, password: temporaryPassword, then: "edit", focus: here });
    feedback.note(s.created(user.name));
    if (!here) {
      announce(s.created(user.name));
      focusIfLost(`user-${user.id}-edit`);
    }
    void collection.refresh();
  }

  async function reset(user: AdminUser) {
    const stillOpen = panel.claim(`reset:${user.id}`);
    try {
      const { temporaryPassword } = await api.resetPassword(user.id);
      const open = stillOpen();
      const here = open && focusInRow(`reset:${user.id}`);
      if (open) panel.close();
      putSecret({ userId: user.id, password: temporaryPassword, then: "reset", focus: here });
      if (!here) {
        announce(m.admin.temporaryPassword(user.name));
        focusIfLost(`user-${user.id}-reset`);
      }
      void collection.refresh();
    } catch (err) {
      failed(user, stillOpen, err);
    }
  }

  async function remove(user: AdminUser) {
    const stillOpen = panel.claim(`delete:${user.id}`);
    try {
      await api.deleteUser(user.id);
    } catch (err) {
      return failed(user, stillOpen, err);
    }
    gone(user, stillOpen, s.deleted(user.name), "success");
  }

  const noted = (done: Secret) => {
    dropSecret(done.userId);
    // Kept shown until the filter changes, so its button can take the focus.
    feedback.pin(done.userId);
    void focusById(`user-${done.userId}-${done.then}`);
  };

  const total = users?.length ?? 0;
  // Matches only: a row kept for another reason is not a result of the filter.
  const count = !users ? "" : query.trim() ? s.countFiltered(users.filter((u) => matched.has(u.id)).length, total) : s.count(total);
  const entries = withTombstones(shown, feedback.tombstones);

  return (
    <Page width="list">
      <div onKeyDown={panel.onKeyDown}>
        <AdminPageHeader tab="users" description={s.description} />
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
                <Button id="users-new" aria-expanded={panel.isOpen(NEW)} aria-controls={panel.isOpen(NEW) ? "users-new-panel" : undefined} onClick={() => toggle(NEW)}>
                  <UserPlus aria-hidden="true" />
                  {s.add}
                </Button>
              }
            />
            {panel.isOpen(NEW) && (
              <div id="users-new-panel" className="panel mb-6 p-4 sm:p-6">
                <UserForm mode="new" onSubmit={create} onCancel={panel.cancel} />
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
            {collection.status === "loading" ? (
              <ListSkeleton leading />
            ) : entries.length === 0 ? (
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
              <DataList label={s.title}>
                {entries.map((entry) =>
                  entry.kind === "tombstone" ? (
                    <TombstoneRow key={`tombstone-${entry.tombstone.id}`} tombstone={entry.tombstone} />
                  ) : (
                    <UserRow
                      key={entry.item.id}
                      user={entry.item}
                      self={entry.item.id === me.id}
                      panel={panel}
                      error={feedback.rowErrors[entry.item.id]}
                      secret={Object.hasOwn(secrets, entry.item.id) ? secrets[entry.item.id]! : null}
                      onToggle={toggle}
                      onSave={save}
                      onReset={reset}
                      onDelete={remove}
                      onNoted={noted}
                    />
                  ),
                )}
              </DataList>
            )}
          </>
        )}
      </div>
    </Page>
  );
}

type UserRowProps = {
  user: AdminUser;
  self: boolean;
  panel: RowPanel;
  error?: string;
  secret: Secret | null;
  onToggle: (key: string) => void;
  onSave: (user: AdminUser, changes: UserChanges) => Promise<void>;
  onReset: (user: AdminUser) => Promise<void>;
  onDelete: (user: AdminUser) => Promise<void>;
  onNoted: (secret: Secret) => void;
};

function UserRow({ user, self, panel, error, secret, onToggle, onSave, onReset, onDelete, onNoted }: UserRowProps) {
  const m = useStrings();
  const s = m.users;
  const b = s.badges;
  const { language } = useLocale();
  const id = `user-${user.id}`;
  const editing = panel.isOpen(`edit:${user.id}`);
  const resetting = panel.isOpen(`reset:${user.id}`);
  const deleting = panel.isOpen(`delete:${user.id}`);
  const open = editing || resetting || deleting;
  const errorText = (err: unknown) => adminErrorText(err, m);

  return (
    <DataRow
      titleId={`${id}-title`}
      title={user.name}
      leading={<PersonTile id={user.id} name={user.name} language={language} disabled={user.disabled} />}
      badges={
        <>
          {self && <Badge variant="primary">{b.you}</Badge>}
          {user.disabled && <Badge variant="destructive">{b.disabled}</Badge>}
          {user.mustChangePassword && <Badge variant="warning">{b.temporary}</Badge>}
          {user.role === "admin" && <Badge variant="info">{b.admin}</Badge>}
          {user.roleSource === "override" && <Badge variant="outline">{b.forced}</Badge>}
        </>
      }
      meta={
        <>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="font-mono text-[0.8125rem] wrap-anywhere">{user.email}</p>
            <Badge variant="outline">
              {user.origin === "local" ? <KeyRound aria-hidden="true" /> : <Building2 aria-hidden="true" />}
              {b.origin[user.origin]}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <p className="flex items-start gap-1.5">
              <Clock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              {user.lastSignInAt ? (
                <span>
                  {s.lastSignIn}{" "}
                  <time dateTime={user.lastSignInAt}>
                    {new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(user.lastSignInAt))}
                  </time>
                </span>
              ) : (
                s.never
              )}
            </p>
            <p className="flex min-w-0 items-start gap-1.5 wrap-anywhere">
              <Users aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {s.groups} {user.groups.length > 0 ? user.groups.map((g) => (g.source === "oidc" ? `${g.name} ${s.fromProvider}` : g.name)).join(", ") : s.noGroups}
              </span>
            </p>
          </div>
        </>
      }
      actions={
        <>
          <Button
            id={`${id}-edit`}
            size="sm"
            className="h-11"
            variant="outline"
            aria-label={s.editLabel(user.name)}
            aria-expanded={editing}
            aria-controls={editing ? `${id}-panel` : undefined}
            onClick={() => onToggle(`edit:${user.id}`)}
          >
            <Pencil aria-hidden="true" />
            {s.edit}
          </Button>
          {user.origin === "local" && !self && (
            <Button id={`${id}-reset`} size="sm" className="h-11" variant="ghost" aria-label={s.resetLabel(user.name)} onClick={() => onToggle(`reset:${user.id}`)}>
              <KeyRound aria-hidden="true" />
              {s.resetPassword}
            </Button>
          )}
          {!self && (
            <Button id={`${id}-delete`} size="sm" className="h-11" variant="destructive-ghost" aria-label={s.deleteLabel(user.name)} onClick={() => onToggle(`delete:${user.id}`)}>
              <Trash2 aria-hidden="true" />
              {m.admin.delete}
            </Button>
          )}
        </>
      }
      error={error}
      panel={
        (secret || open) && (
          <div id={`${id}-panel`} className="flex flex-col gap-4">
            {secret && <SecretPanel key={`${user.id}:${secret.password}`} name={user.name} password={secret.password} autoFocus={secret.focus} onDone={() => onNoted(secret)} />}
            {editing && <UserForm mode="edit" user={user} self={self} onSubmit={(changes) => onSave(user, changes)} onCancel={panel.cancel} />}
            {resetting && (
              <ConfirmPanel
                variant="default"
                question={s.resetQuestion(user.name)}
                confirmLabel={s.reset}
                pendingLabel={s.resetting}
                onConfirm={() => onReset(user)}
                onCancel={panel.cancel}
                errorText={errorText}
              >
                <p>{s.resetDetails}</p>
              </ConfirmPanel>
            )}
            {deleting && (
              <ConfirmPanel
                question={s.deleteQuestion(user.name)}
                confirmLabel={m.admin.confirmDelete}
                pendingLabel={m.admin.deleting}
                onConfirm={() => onDelete(user)}
                onCancel={panel.cancel}
                errorText={errorText}
              >
                <p>{s.deleteDetails}</p>
                {user.origin === "oidc" && <p>{s.deleteOidcNotice}</p>}
              </ConfirmPanel>
            )}
          </div>
        )
      }
    />
  );
}

type UserField = "name" | "email" | "role" | "roleOverride" | "disabled";
const USER_FIELDS = ["name", "email", "role", "roleOverride", "disabled"] as const;

type UserFormProps =
  | { mode: "new"; onSubmit: (input: { name: string; email: string; role: Role }) => Promise<void>; onCancel: () => void }
  | { mode: "edit"; user: AdminUser; self: boolean; onSubmit: (changes: UserChanges) => Promise<void>; onCancel: () => void };

/** Return the changes the form makes to the user as it was when the form opened, leaving out what stays the same. */
function changesOf(user: AdminUser, form: { name: string; email: string; role: Role; override: Role | ""; disabled: boolean }): UserChanges {
  const changes: UserChanges = {};
  if (form.name.trim() !== user.name) changes.name = form.name;
  if (user.origin === "local" && form.email.trim().toLowerCase() !== user.email) changes.email = form.email;
  if (user.origin === "local" && form.role !== user.role) changes.role = form.role;
  if (user.origin === "oidc" && (form.override || null) !== user.roleOverride) changes.roleOverride = form.override || null;
  if (form.disabled !== user.disabled) changes.disabled = form.disabled;
  return changes;
}

/** Form creating a local account, or changing one in its row; it opens on its first field. */
function UserForm(props: UserFormProps) {
  const m = useStrings();
  const s = m.users;
  // As it was on opening: a save of another opening may change the row meanwhile, and untouched fields must not
  // send its old values back.
  const [edited] = useState(props.mode === "edit" ? props.user : null);
  const formId = edited ? `user-${edited.id}-form` : "users-new-form";
  const errors = useFormErrors<UserField>(USER_FIELDS, formId);
  const [name, setName] = useState(edited?.name ?? "");
  const [email, setEmail] = useState(edited?.email ?? "");
  const [role, setRole] = useState<Role>(edited?.role ?? "user");
  const [override, setOverride] = useState<Role | "">(edited?.roleOverride ?? "");
  const [disabled, setDisabled] = useState(edited?.disabled ?? false);
  const [pending, setPending] = useState(false);
  const local = !edited || edited.origin === "local";
  const self = props.mode === "edit" && props.self;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = errors.check({
      name: name.trim() === "" && m.fieldErrors.required,
      email: local && email.trim() === "" && m.fieldErrors.required,
    });
    if (!ok) return;
    setPending(true);
    try {
      if (props.mode === "new") await props.onSubmit({ name, email, role });
      else await props.onSubmit(changesOf(edited!, { name, email, role, override, disabled }));
    } catch (err) {
      errors.failWith(err, {
        codes: {
          last_local_admin: { message: m.admin.errors.last_local_admin },
          cannot_change_self: { message: m.admin.errors.cannot_change_self },
        },
        fallback: adminErrorText,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <InlineForm id={formId} aria-label={edited ? s.editLabel(edited.name) : s.newTitle} onSubmit={submit} onCancel={props.onCancel} className="max-w-md">
      <FormStack>
        <ErrorSummary errors={errors} labels={{ name: s.name, email: s.email }} />
        <Field {...errors.field("name")} label={s.name} required autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        {local ? (
          <Field {...errors.field("email")} label={s.email} type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold">{s.emailFromProvider}</p>
            <p className="text-sm wrap-anywhere">{edited?.email}</p>
          </div>
        )}
        {self && <p className="text-sm text-muted-foreground">{s.selfNote}</p>}
        {!self && local && (
          <CheckboxField id={errors.fieldId("role")} label={s.makeAdmin} checked={role === "admin"} onChange={(e) => setRole(e.target.checked ? "admin" : "user")} />
        )}
        {!self && !local && (
          <SelectField
            {...errors.field("roleOverride")}
            label={s.roleOverride}
            value={override}
            onChange={(e) => setOverride(e.target.value === "admin" || e.target.value === "user" ? e.target.value : "")}
          >
            <option value="">{s.roleOverrideOptions.provider}</option>
            <option value="admin">{s.roleOverrideOptions.admin}</option>
            <option value="user">{s.roleOverrideOptions.user}</option>
          </SelectField>
        )}
        {!self && edited && (
          <CheckboxField id={errors.fieldId("disabled")} label={s.disabled} hint={s.disabledHint} checked={disabled} onChange={(e) => setDisabled(e.target.checked)} />
        )}
        <FormActions>
          <SubmitButton pending={pending} pendingLabel={edited ? m.admin.saving : s.creating}>
            {edited ? m.admin.save : s.create}
          </SubmitButton>
          <Button type="button" variant="outline" onClick={props.onCancel}>
            {m.admin.cancel}
          </Button>
        </FormActions>
      </FormStack>
    </InlineForm>
  );
}
