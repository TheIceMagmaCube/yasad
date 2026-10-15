import { type FormEvent, useEffect, useRef, useState } from "react";

import { api, ApiError } from "../api";
import { Field, SubmitButton } from "../components/Field";
import { errorMessage, fieldErrorMessage } from "../i18n/errors";
import { useStrings } from "../i18n/LocaleProvider";

type Fields = { current?: string; new?: string; confirm?: string };

/** Replace the temporary password; shown inside the app shell until it is done. */
export function ChangePassword({ onChanged }: { onChanged: () => void }) {
  const m = useStrings();
  const s = m.changePassword;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fields, setFields] = useState<Fields>({});
  const [error, setError] = useState<{ text: string; n: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const fail = (text: string, nextFields: Fields = {}) => {
    setFields(nextFields);
    setError((prev) => ({ text, n: (prev?.n ?? 0) + 1 }));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next.length < 12) return fail(m.setup.checkFields, { new: m.setup.passwordTooShort });
    if (confirm !== next) return fail(m.setup.checkFields, { confirm: m.setup.passwordMismatch });
    setBusy(true);
    try {
      await api.changePassword(current, next);
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.body.code === "invalid_password") fail(s.wrongCurrent, { current: s.wrongCurrent });
      else if (err instanceof ApiError && err.body.code === "invalid_input") {
        fail(m.setup.checkFields, { new: fieldErrorMessage(err.body.fields?.newPassword ?? "", m) });
      } else fail(errorMessage(err, m));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-sm">
      <h1 className="text-2xl font-bold">{s.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{s.intro}</p>
      {error && (
        <div ref={errorRef} tabIndex={-1} role="alert" className="mt-4 rounded-md border border-destructive p-3 text-sm text-destructive outline-none">
          {error.text}
        </div>
      )}
      <form onSubmit={submit} noValidate>
        <Field
          id="current-password"
          label={s.current}
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          error={fields.current}
        />
        <Field
          id="new-password"
          label={s.new}
          type="password"
          autoComplete="new-password"
          required
          hint={s.newHint}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          error={fields.new}
        />
        <Field
          id="confirm-password"
          label={s.confirm}
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={fields.confirm}
        />
        <SubmitButton busy={busy}>{s.submit}</SubmitButton>
      </form>
    </div>
  );
}
