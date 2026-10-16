import { type FormEvent, useEffect, useRef, useState } from "react";

import { api, ApiError } from "../api";
import { AuthLayout } from "../components/AuthLayout";
import { Field, SubmitButton } from "../components/Field";
import { errorMessage } from "../i18n/errors";
import { useStrings } from "../i18n/LocaleProvider";
import { useInstance } from "../instance";
import { useDocumentTitle } from "../lib/page";

/**
 * Sign-in screen. With password sign-in off, the default path only says so; `local` (the
 * /sign-in/local path) still shows the form, which the server accepts for local admins only.
 */
export function SignIn({ onSignedIn, local = false }: { onSignedIn: () => void; local?: boolean }) {
  const m = useStrings();
  const s = m.signIn;
  const { passwordSignIn } = useInstance();
  useDocumentTitle(!passwordSignIn && !local ? s.disabledTitle : s.title);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.signIn(email, password);
      onSignedIn();
    } catch (err) {
      const code = err instanceof ApiError ? err.body.code : null;
      setError(err instanceof ApiError && err.status === 401 ? s.invalid : code === "account_disabled" ? s.accountDisabled : errorMessage(err, m));
    } finally {
      setBusy(false);
    }
  }

  if (!passwordSignIn && !local) {
    return (
      <AuthLayout>
        <h1 className="text-2xl font-bold">{s.disabledTitle}</h1>
        <p className="mt-4 text-sm">{s.disabled}</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className="text-2xl font-bold">{s.title}</h1>
      {!passwordSignIn && <p className="mt-2 text-sm text-muted-foreground">{s.adminsOnly}</p>}
      {error && (
        <div ref={errorRef} tabIndex={-1} role="alert" className="mt-4 rounded-md border border-destructive p-3 text-sm text-destructive outline-none">
          {error}
        </div>
      )}
      <form onSubmit={submit} noValidate>
        <Field id="email" label={s.email} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field
          id="password"
          label={s.password}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <SubmitButton busy={busy}>{s.submit}</SubmitButton>
      </form>
    </AuthLayout>
  );
}
