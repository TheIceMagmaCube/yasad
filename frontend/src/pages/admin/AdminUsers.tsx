import { type FormEvent, useEffect, useId, useState } from "react";

import { type AdminUser, api, ApiError, type Role, type User, type UserChanges } from "../../api";
import { Field } from "../../components/Field";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import { fieldErrorMessage } from "../../i18n/errors";
import { useLocale, useStrings } from "../../i18n/LocaleProvider";
import { adminErrorText, ConfirmDelete, NoticeBox, selectClass, TemporaryPassword, useNotice } from "./shared";

type Secret = { name: string; password: string };

/** Admin page: list the accounts, create local ones, change, disable, reset or delete them. */
export function AdminUsers({ me }: { me: User }) {
  const m = useStrings();
  const s = m.users;
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [notice, say] = useNotice();
  const [secret, setSecret] = useState<Secret | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.users().then(setUsers, (err: unknown) => {
      setUsers([]);
      say(adminErrorText(err, m), "error");
    });

  useEffect(() => {
    void load();
    // Loaded once; every action reloads the list itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Run an admin action, then reload the list; a failure is announced, and a vanished item reloads too. */
  async function act(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      say(adminErrorText(err, m), "error");
    } finally {
      setBusy(false);
      await load();
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{s.title}</h2>
        {!adding && (
          <Button type="button" onClick={() => setAdding(true)}>
            {s.add}
          </Button>
        )}
      </div>

      <NoticeBox notice={notice} />
      {secret && <TemporaryPassword name={secret.name} password={secret.password} onDone={() => setSecret(null)} />}
      {adding && (
        <NewUser
          onCancel={() => setAdding(false)}
          onCreated={(user, password) => {
            setAdding(false);
            setSecret({ name: user.name, password });
            void load();
          }}
        />
      )}

      {users === null ? (
        <p role="status" className="mt-6">
          {m.loading}
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {users.map((user) => (
            <li key={user.id} className="rounded-md border border-border p-4">
              <UserSummary user={user} self={user.id === me.id} />
              {editing === user.id ? (
                <EditUser
                  user={user}
                  self={user.id === me.id}
                  busy={busy}
                  onCancel={() => setEditing(null)}
                  onSave={(changes) =>
                    void act(async () => {
                      await api.updateUser(user.id, changes);
                      setEditing(null);
                      say(s.edited(changes.name ?? user.name));
                    })
                  }
                />
              ) : deleting === user.id ? (
                <ConfirmDelete
                  question={s.deleteQuestion(user.name)}
                  busy={busy}
                  onCancel={() => setDeleting(null)}
                  onConfirm={() =>
                    void act(async () => {
                      setDeleting(null);
                      await api.deleteUser(user.id);
                      say(s.deleted(user.name));
                    })
                  }
                >
                  {user.origin === "oidc" && <p className="mt-2">{s.deleteOidcNotice}</p>}
                </ConfirmDelete>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditing(user.id)} aria-label={`${m.admin.edit} ${user.name}`}>
                    {m.admin.edit}
                  </Button>
                  {user.origin === "local" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      aria-label={`${s.resetPassword}: ${user.name}`}
                      onClick={() =>
                        void act(async () => {
                          const { temporaryPassword } = await api.resetPassword(user.id);
                          setSecret({ name: user.name, password: temporaryPassword });
                        })
                      }
                    >
                      {s.resetPassword}
                    </Button>
                  )}
                  {user.id !== me.id && (
                    <Button type="button" size="sm" variant="outline" onClick={() => setDeleting(user.id)} aria-label={`${m.admin.delete} ${user.name}`}>
                      {m.admin.delete}
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UserSummary({ user, self }: { user: AdminUser; self: boolean }) {
  const m = useStrings();
  const s = m.users;
  const { language } = useLocale();
  const source = s.roleSource[user.roleSource];
  return (
    <div>
      <h3 className="font-semibold break-words">
        {user.name}
        {self && <span className="font-normal text-muted-foreground"> ({s.you})</span>}
        {user.disabled && <span className="ml-2 rounded-sm border border-destructive px-1.5 text-xs text-destructive">{s.disabled}</span>}
      </h3>
      <p className="text-sm break-all text-muted-foreground">{user.email}</p>
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="font-semibold">{m.users.roleOverride}</dt>
        <dd>
          {s.role[user.role]}
          {source && <span className="text-muted-foreground"> ({source})</span>}
          {" · "}
          {s.origin[user.origin]}
        </dd>
        <dt className="font-semibold">{s.groups}</dt>
        <dd>{user.groups.length > 0 ? user.groups.map((g) => g.name).join(", ") : s.noGroups}</dd>
        <dt className="font-semibold">{s.lastSignIn}</dt>
        <dd>
          {user.lastSignInAt
            ? new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(user.lastSignInAt))
            : s.never}
        </dd>
      </dl>
    </div>
  );
}

function NewUser({ onCancel, onCreated }: { onCancel: () => void; onCreated: (user: AdminUser, password: string) => void }) {
  const m = useStrings();
  const s = m.users;
  const id = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [admin, setAdmin] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { user, temporaryPassword } = await api.createUser({ name, email, role: admin ? "admin" : "user" });
      onCreated(user, temporaryPassword);
    } catch (err) {
      if (err instanceof ApiError && err.body.fields) {
        setFields(Object.fromEntries(Object.entries(err.body.fields).map(([k, code]) => [k, fieldErrorMessage(code, m)])));
        setError(m.setup.checkFields);
      } else setError(adminErrorText(err, m));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby={`${id}-title`} className="mt-4 max-w-md rounded-md border border-border p-4">
      <h3 id={`${id}-title`} className="font-semibold">
        {s.add}
      </h3>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Field id={`${id}-name`} label={s.name} required autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} error={fields.name} />
      <Field id={`${id}-email`} label={s.email} type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} />
      <div className="mt-4 flex items-center gap-2">
        <input id={`${id}-admin`} type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} className="size-4 accent-primary" />
        <Label htmlFor={`${id}-admin`}>{s.makeAdmin}</Label>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>
          {s.create}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {m.admin.cancel}
        </Button>
      </div>
    </form>
  );
}

/** Return the changes the form makes to the user, leaving out what stays the same. */
function changesOf(user: AdminUser, form: { name: string; role: Role; override: Role | ""; disabled: boolean }): UserChanges {
  const changes: UserChanges = {};
  if (form.name.trim() !== user.name) changes.name = form.name;
  if (user.origin === "local" && form.role !== user.role) changes.role = form.role;
  if (user.origin === "oidc" && (form.override || null) !== user.roleOverride) changes.roleOverride = form.override || null;
  if (form.disabled !== user.disabled) changes.disabled = form.disabled;
  return changes;
}

function EditUser({ user, self, busy, onCancel, onSave }: { user: AdminUser; self: boolean; busy: boolean; onCancel: () => void; onSave: (changes: UserChanges) => void }) {
  const m = useStrings();
  const s = m.users;
  const id = useId();
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<Role>(user.role);
  const [override, setOverride] = useState<Role | "">(user.roleOverride ?? "");
  const [disabled, setDisabled] = useState(user.disabled);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(changesOf(user, { name, role, override, disabled }));
      }}
      noValidate
      aria-label={`${m.admin.edit} ${user.name}`}
      className="mt-3 max-w-md"
    >
      <Field id={`${id}-name`} label={s.name} required autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      {!self && user.origin === "local" && (
        <div className="mt-4 flex items-center gap-2">
          <input id={`${id}-admin`} type="checkbox" checked={role === "admin"} onChange={(e) => setRole(e.target.checked ? "admin" : "user")} className="size-4 accent-primary" />
          <Label htmlFor={`${id}-admin`}>{s.makeAdmin}</Label>
        </div>
      )}
      {!self && user.origin === "oidc" && (
        <div className="mt-4">
          <Label htmlFor={`${id}-override`}>{s.roleOverride}</Label>
          <select id={`${id}-override`} className={selectClass} value={override} onChange={(e) => setOverride(e.target.value === "admin" || e.target.value === "user" ? e.target.value : "")}>
            <option value="">{s.roleOverrideOptions.provider}</option>
            <option value="admin">{s.roleOverrideOptions.admin}</option>
            <option value="user">{s.roleOverrideOptions.user}</option>
          </select>
        </div>
      )}
      {!self && (
        <div className="mt-4 flex items-center gap-2">
          <input id={`${id}-disabled`} type="checkbox" checked={disabled} onChange={(e) => setDisabled(e.target.checked)} className="size-4 accent-primary" />
          <Label htmlFor={`${id}-disabled`}>{s.disabled}</Label>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>
          {m.admin.save}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {m.admin.cancel}
        </Button>
      </div>
    </form>
  );
}
