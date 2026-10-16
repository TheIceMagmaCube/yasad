import { type FormEvent, useState } from "react";

import { api, type User } from "../../api";
import { useStrings } from "../../i18n/LocaleProvider";
import { useFormErrors } from "../../lib/form-errors";
import { ErrorSummary } from "../form/ErrorSummary";
import { Field } from "../form/Field";
import { FormActions, FormStack } from "../form/FormLayout";
import { InlineForm } from "../form/InlineForm";
import { PasswordField } from "../form/PasswordField";
import { SubmitButton } from "../form/PendingButton";
import { Button } from "../ui/button";

const FIELDS = ["name", "email", "currentPassword"] as const;

/** Return the e-mail as the server stores it, to tell whether it changes. */
const normalized = (email: string) => email.trim().toLowerCase();

type ProfileFormProps = {
  id: string;
  user: User;
  /** Run once the server saved a change; the form stays pending until it resolves. */
  onSaved: () => Promise<unknown>;
  /** Close without saving: Cancel, Escape, or a submission that changes nothing. */
  onCancel: () => void;
};

/**
 * Edit the name and e-mail of a local account. A new e-mail asks for the current password, in a field that shows
 * only then.
 */
export function ProfileForm({ id, user, onSaved, onCancel }: ProfileFormProps) {
  const m = useStrings();
  const a = m.account;
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [currentPassword, setCurrentPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const errors = useFormErrors(FIELDS, id);
  const emailChanges = normalized(email) !== normalized(user.email);

  /** Follow the e-mail; once it is back to the saved one, the password field goes, and its error with it. */
  function changeEmail(value: string) {
    setEmail(value);
    if (normalized(value) === normalized(user.email)) errors.clear("currentPassword");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = errors.check({
      name: name.trim() === "" && m.fieldErrors.required,
      email: email.trim() === "" && m.fieldErrors.required,
      currentPassword: emailChanges && currentPassword === "" && m.fieldErrors.required,
    });
    if (!ok) return;
    const nameChanges = name.trim() !== user.name;
    if (!nameChanges && !emailChanges) {
      onCancel();
      return;
    }
    setBusy(true);
    try {
      await api.updateProfile({ ...(nameChanges && { name }), ...(emailChanges && { email, currentPassword }) });
      await onSaved();
    } catch (err) {
      errors.failWith(err, {
        codes: {
          invalid_password: { message: m.changePassword.wrongCurrent, field: "currentPassword" },
          profile_from_provider: { message: a.fromProvider },
        },
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <InlineForm id={id} onSubmit={submit} onCancel={onCancel}>
      <FormStack>
        <ErrorSummary errors={errors} labels={{ name: a.name, email: a.email, currentPassword: a.currentPassword }} />
        <Field label={a.name} autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} {...errors.field("name")} />
        <Field label={a.email} type="email" autoComplete="email" required value={email} onChange={(e) => changeEmail(e.target.value)} {...errors.field("email")} />
        {emailChanges && (
          <PasswordField
            label={a.currentPassword}
            hint={a.currentPasswordHint}
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            {...errors.field("currentPassword")}
          />
        )}
        <FormActions>
          <SubmitButton pending={busy} pendingLabel={a.saving}>
            {a.save}
          </SubmitButton>
          <Button type="button" variant="outline" onClick={onCancel}>
            {a.cancel}
          </Button>
        </FormActions>
      </FormStack>
    </InlineForm>
  );
}
