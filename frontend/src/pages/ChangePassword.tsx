import { type FormEvent, useState } from "react";

import { api } from "../api";
import { ErrorSummary } from "../components/form/ErrorSummary";
import { FormActions, FormStack } from "../components/form/FormLayout";
import { PasswordField } from "../components/form/PasswordField";
import { SubmitButton } from "../components/form/PendingButton";
import { Page } from "../components/Page";
import { useStrings } from "../i18n/LocaleProvider";
import { confirmationProblem, newPasswordProblem, useFormErrors } from "../lib/form-errors";
import { useDocumentTitle } from "../lib/page";

const FIELDS = ["current", "new", "confirm"] as const;

/** Replace the temporary password; shown inside the app shell until it is done. */
export function ChangePassword({ onChanged }: { onChanged: () => void }) {
  const m = useStrings();
  const s = m.changePassword;
  useDocumentTitle(s.title);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const errors = useFormErrors(FIELDS, "change-password");

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
      onChanged();
    } catch (err) {
      errors.failWith(err, { codes: { invalid_password: { message: s.wrongCurrent, field: "current" } }, rename: { newPassword: "new", currentPassword: "current" } });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page width="form">
      <h1 tabIndex={-1} className="text-title outline-none">
        {s.title}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">{s.intro}</p>
      <form onSubmit={submit} noValidate className="mt-6">
        <FormStack>
          <ErrorSummary errors={errors} />
          <PasswordField label={s.current} autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} {...errors.field("current")} />
          <PasswordField label={s.new} autoComplete="new-password" required hint={s.newHint} value={next} onChange={(e) => setNext(e.target.value)} {...errors.field("new")} />
          <PasswordField label={s.confirm} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} {...errors.field("confirm")} />
          <FormActions stretch>
            <SubmitButton pending={busy} pendingLabel={s.submitting}>
              {s.submit}
            </SubmitButton>
          </FormActions>
        </FormStack>
      </form>
    </Page>
  );
}
