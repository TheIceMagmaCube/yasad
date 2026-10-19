import { KeyRound, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";

import { type AdminGroup, type AdminUser, api, type Role, type UserChanges } from "../../../api";
import { ConfirmPanel } from "../../../components/admin/ConfirmPanel";
import { AdminShell } from "../../../components/admin/AdminShell";
import { DetailColumns, listHref, PaneDanger, PaneSection } from "../../../components/admin/DetailPage";
import { SecretPanel } from "../../../components/admin/SecretPanel";
import { StateMark } from "../../../components/admin/StateMark";
import { ErrorSummary } from "../../../components/form/ErrorSummary";
import { Field } from "../../../components/form/Field";
import { FormActions, FormStack } from "../../../components/form/FormLayout";
import { SubmitButton } from "../../../components/form/PendingButton";
import { SelectField } from "../../../components/form/SelectField";
import { Alert } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { CheckboxField } from "../../../components/ui/checkbox";
import { useLocale, useStrings } from "../../../i18n/LocaleProvider";
import { useAnnounce } from "../../../lib/announcer";
import { focusById } from "../../../lib/focus";
import { useFormErrors } from "../../../lib/form-errors";
import { invalidateHome } from "../../../lib/home-store";
import { formatRelative } from "../../../lib/relative-time";
import { adminErrorText, PersonTile } from "../shared";

const LIST = "/admin/users";

type UserField = "name" | "email" | "role" | "roleOverride" | "disabled";
const USER_FIELDS = ["name", "email", "role", "roleOverride", "disabled"] as const;

/** Return the changes the form makes to the user as it was when the pane opened, leaving out what stays the same. */
function changesOf(user: AdminUser, form: { name: string; email: string; role: Role; override: Role | ""; disabled: boolean }): UserChanges {
  const changes: UserChanges = {};
  if (form.name.trim() !== user.name) changes.name = form.name;
  if (user.origin === "local" && form.email.trim().toLowerCase() !== user.email) changes.email = form.email;
  if (user.origin === "local" && form.role !== user.role) changes.role = form.role;
  if (user.origin === "oidc" && (form.override || null) !== user.roleOverride) changes.roleOverride = form.override || null;
  if (form.disabled !== user.disabled) changes.disabled = form.disabled;
  return changes;
}

type PersonPageProps = {
  user: AdminUser;
  self: boolean;
  localGroups: AdminGroup[];
  /** Temporary password not noted yet. */
  secret: string | null;
  onUpdated: (user: AdminUser, text: string) => void;
  /** A membership the server confirmed. */
  onMembership: (group: AdminGroup, member: boolean) => void;
  onSecret: (password: string) => void;
  onNoted: () => void;
  onDeleted: () => void;
};

/** Page of a person: profile at the left, groups and details at the right, reset and delete at the bottom. */
export function PersonPage({ user, self, localGroups, secret, onUpdated, onMembership, onSecret, onNoted, onDeleted }: PersonPageProps) {
  const m = useStrings();
  const s = m.users;
  const { language } = useLocale();
  const [confirm, setConfirm] = useState<"reset" | "delete" | null>(null);
  // A closed confirmation or a noted password gives the focus back to the button that led there.
  const back = (trigger: "reset" | "delete") => {
    setConfirm(null);
    void focusById(`person-${trigger}`);
  };
  const errorText = (err: unknown) => adminErrorText(err, m);
  const providerGroups = user.groups.filter((g) => g.source === "oidc");
  const last = formatRelative(user.lastSignInAt, language, m);

  return (
    <AdminShell
      section="users"
      title={user.name}
      back={{ href: listHref(LIST), label: m.admin.backTo(s.title) }}
      leading={<PersonTile id={user.id} name={user.name} language={language} disabled={user.disabled} className="mt-1" />}
      subtitle={
        <>
          <p className="wrap-anywhere">{user.email}</p>
          {user.disabled && <StateMark tone="destructive" className="text-base text-foreground">{s.disabledSentence}</StateMark>}
          {!user.disabled && user.mustChangePassword && <StateMark tone="warning" className="text-base text-foreground">{s.temporarySentence}</StateMark>}
        </>
      }
    >
      {secret && (
        <div className="mb-10">
          <SecretPanel
            key={`${user.id}:${secret}`}
            name={user.name}
            password={secret}
            onDone={() => {
              onNoted();
              void focusById(["person-reset", "person-delete"]);
            }}
          />
        </div>
      )}
      <DetailColumns
        main={
          <PaneSection title={s.profile}>
            <ProfileForm user={user} self={self} onSaved={(updated) => onUpdated(updated, s.edited(updated.name))} />
          </PaneSection>
        }
        side={
          <>
            <PaneSection title={s.localGroups}>
              <Memberships user={user} groups={localGroups} onMembership={onMembership} />
            </PaneSection>
            {user.origin === "oidc" && (
              <PaneSection title={s.providerGroups}>
                {providerGroups.length > 0 ? (
                  <ul className="flex flex-wrap gap-x-4 gap-y-1">
                    {providerGroups.map((g) => (
                      <li key={g.id}>{g.name}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm">{s.noProviderGroups}</p>
                )}
              </PaneSection>
            )}
            <PaneSection title={s.details}>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-y-2">
                <dt className="text-muted-foreground">{s.origin}</dt>
                <dd className="mb-2 sm:mb-0">{s.originValue[user.origin]}</dd>
                <dt className="text-muted-foreground">{s.columns.lastSignIn}</dt>
                <dd>{last.exact ?? last.text}</dd>
              </dl>
            </PaneSection>
          </>
        }
        danger={
          !self && (
            <PaneDanger>
              {confirm === "reset" ? (
                <ConfirmPanel
                  variant="default"
                  question={s.resetQuestion(user.name)}
                  confirmLabel={s.reset}
                  pendingLabel={s.resetting}
                  onConfirm={async () => {
                    const { temporaryPassword } = await api.resetPassword(user.id);
                    setConfirm(null);
                    onSecret(temporaryPassword);
                  }}
                  onCancel={() => back("reset")}
                  errorText={errorText}
                >
                  <p>{s.resetDetails}</p>
                </ConfirmPanel>
              ) : confirm === "delete" ? (
                <ConfirmPanel
                  question={s.deleteQuestion(user.name)}
                  confirmLabel={m.admin.confirmDelete}
                  pendingLabel={m.admin.deleting}
                  onConfirm={async () => {
                    await api.deleteUser(user.id);
                    onDeleted();
                  }}
                  onCancel={() => back("delete")}
                  errorText={errorText}
                >
                  <p>{s.deleteDetails}</p>
                  {user.origin === "oidc" && <p>{s.deleteOidcNotice}</p>}
                </ConfirmPanel>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {user.origin === "local" && (
                    <Button id="person-reset" variant="outline" onClick={() => setConfirm("reset")}>
                      <KeyRound aria-hidden="true" />
                      {s.resetPassword}
                    </Button>
                  )}
                  <Button id="person-delete" variant="destructive-ghost" onClick={() => setConfirm("delete")}>
                    <Trash2 aria-hidden="true" />
                    {s.deleteLabel(user.name)}
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

/** Profile of a person: name, e-mail (read only from the provider), role, disabled; saved with one button. */
function ProfileForm({ user, self, onSaved }: { user: AdminUser; self: boolean; onSaved: (user: AdminUser) => void }) {
  const m = useStrings();
  const s = m.users;
  const formId = `user-${user.id}-form`;
  const errors = useFormErrors<UserField>(USER_FIELDS, formId);
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<Role>(user.role);
  const [override, setOverride] = useState<Role | "">(user.roleOverride ?? "");
  const [disabled, setDisabled] = useState(user.disabled);
  const [pending, setPending] = useState(false);
  const local = user.origin === "local";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!errors.check({ name: name.trim() === "" && m.fieldErrors.required, email: local && email.trim() === "" && m.fieldErrors.required })) return;
    const changes = changesOf(user, { name, email, role, override, disabled });
    if (Object.keys(changes).length === 0) return;
    setPending(true);
    try {
      const { user: updated } = await api.updateUser(user.id, changes);
      onSaved(updated);
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
    <form id={formId} noValidate aria-label={s.profile} onSubmit={submit}>
      <FormStack className="gap-4">
        <ErrorSummary errors={errors} labels={{ name: s.name, email: s.email }} />
        <Field {...errors.field("name")} label={s.name} required autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        {local ? (
          <Field {...errors.field("email")} label={s.email} type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold">{s.email}</p>
            <p className="text-sm wrap-anywhere">{user.email}</p>
            <p className="text-sm text-muted-foreground">{s.emailManaged}</p>
          </div>
        )}
        {self && <p className="text-sm text-muted-foreground">{s.selfNote}</p>}
        {!self && local && (
          <CheckboxField id={errors.fieldId("role")} label={s.makeAdmin} checked={role === "admin"} onChange={(e) => setRole(e.target.checked ? "admin" : "user")} />
        )}
        {!self && !local && (
          <SelectField
            {...errors.field("roleOverride")}
            label={s.role}
            value={override}
            onChange={(e) => setOverride(e.target.value === "admin" || e.target.value === "user" ? e.target.value : "")}
          >
            <option value="">{s.roleOverrideOptions.provider}</option>
            <option value="admin">{s.roleOverrideOptions.admin}</option>
            <option value="user">{s.roleOverrideOptions.user}</option>
          </SelectField>
        )}
        {!self && <CheckboxField id={errors.fieldId("disabled")} label={s.disabled} hint={s.disabledHint} checked={disabled} onChange={(e) => setDisabled(e.target.checked)} />}
        <FormActions>
          <SubmitButton pending={pending} pendingLabel={m.admin.saving}>
            {m.admin.save}
          </SubmitButton>
        </FormActions>
      </FormStack>
    </form>
  );
}

/** Local groups as check boxes: each one adds or removes the membership at once, and says so. */
function Memberships({ user, groups, onMembership }: { user: AdminUser; groups: AdminGroup[]; onMembership: (group: AdminGroup, member: boolean) => void }) {
  const m = useStrings();
  const s = m.users;
  const announce = useAnnounce();
  // The state asked for while its request runs, so the box follows the click; dropped when the request ends.
  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [error, setError] = useState<{ text: string; n: number } | null>(null);
  if (groups.length === 0) return <p className="text-sm text-muted-foreground">{s.noLocalGroups}</p>;
  const held = new Set(user.groups.map((g) => g.id));

  async function toggle(group: AdminGroup, member: boolean) {
    setPending((prev) => new Map(prev).set(group.id, member));
    setError(null);
    try {
      if (member) await api.addMember(group.id, user.id);
      else await api.removeMember(group.id, user.id);
      onMembership(group, member);
      invalidateHome();
      announce(member ? m.groups.added(user.name, group.name) : m.groups.removed(user.name, group.name));
    } catch {
      setError((prev) => ({ text: s.membershipFailed(group.name), n: (prev?.n ?? 0) + 1 }));
    } finally {
      setPending((prev) => {
        const next = new Map(prev);
        next.delete(group.id);
        return next;
      });
    }
  }

  return (
    <>
      <ul className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        {groups.map((group) => (
          <li key={group.id}>
            <CheckboxField
              label={group.name}
              checked={pending.get(group.id) ?? held.has(group.id)}
              aria-busy={pending.has(group.id) || undefined}
              onChange={(e) => {
                if (pending.has(group.id)) return;
                void toggle(group, e.target.checked);
              }}
            />
          </li>
        ))}
      </ul>
      {error && (
        <Alert key={error.n} variant="destructive" autoFocus>
          {error.text}
        </Alert>
      )}
    </>
  );
}
