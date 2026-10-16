import { type FormEvent, type ReactNode, useState } from "react";

import { api, type User } from "../../api";
import { useStrings } from "../../i18n/LocaleProvider";
import { confirmationProblem, newPasswordProblem, useFormErrors } from "../../lib/form-errors";
import { ErrorSummary } from "../form/ErrorSummary";
import { FormActions, FormStack } from "../form/FormLayout";
import { InlineForm } from "../form/InlineForm";
import { PasswordField } from "../form/PasswordField";
import { SubmitButton } from "../form/PendingButton";
import { Button } from "../ui/button";

const FIELDS = ["current", "new", "confirm"] as const;

type PasswordFormProps =
  /** The temporary password step: a page of its own, titled, for the person signed in. */
  | { mode: "temporary"; user: User; onDone: () => void }
  /** A form opened on the account page: it focuses its first field, and Cancel or Escape closes it. */
  | { mode: "account"; id?: string; onDone: () => void; onCancel: () => void };

/**
 * Change the signed-in person's password: current (or temporary) password, new one, confirmation. The local checks
 * run in one pass before anything is sent; `onDone` runs once the server has saved it.
 */
export function PasswordForm(props: PasswordFormProps) {
  const m = useStrings();
  const s = m.changePassword;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const errors = useFormErrors(FIELDS, props.mode === "temporary" ? "change-password" : (props.id ?? "account-password"));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = errors.check({
      current: current === "" && m.fieldErrors.required,
      new: newPasswordProblem(next, m) ?? (next === current && m.fieldErrors.password_unchanged),
      confirm: confirmationProblem(next, confirm, m),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.changePassword(current, next);
    } catch (err) {
      errors.failWith(err, {
        codes: {
          invalid_password: { message: s.wrongCurrent, field: "current" },
          no_local_password: { message: m.admin.errors.no_local_password },
        },
        rename: { newPassword: "new", currentPassword: "current" },
      });
      setBusy(false);
      return;
    }
    setBusy(false);
    props.onDone();
  }

  const fields: ReactNode = (
    <FormStack>
      <ErrorSummary errors={errors} />
      <PasswordField
        label={props.mode === "temporary" ? s.temporary : s.current}
        autoComplete="current-password"
        required
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        {...errors.field("current")}
      />
      <PasswordField label={s.new} autoComplete="new-password" required hint={s.newHint} value={next} onChange={(e) => setNext(e.target.value)} {...errors.field("new")} />
      <PasswordField label={s.confirm} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} {...errors.field("confirm")} />
      <FormActions stretch={props.mode === "temporary"}>
        <SubmitButton pending={busy} pendingLabel={s.submitting}>
          {s.submit}
        </SubmitButton>
        {props.mode === "account" && (
          <Button type="button" variant="outline" onClick={props.onCancel}>
            {s.cancel}
          </Button>
        )}
      </FormActions>
    </FormStack>
  );

  if (props.mode === "account") {
    return (
      <InlineForm id={props.id} onSubmit={submit} onCancel={props.onCancel}>
        {fields}
      </InlineForm>
    );
  }
  return (
    <>
      <h1 tabIndex={-1} className="text-title outline-none">
        {s.title}
      </h1>
      <p className="mt-3">{s.intro}</p>
      <p className="mt-2 text-sm text-muted-foreground wrap-anywhere">{s.signedInAs(props.user.name, props.user.email)}</p>
      <form onSubmit={submit} noValidate className="mt-6">
        {fields}
      </form>
    </>
  );
}
