import { type FormEvent, useEffect, useRef, useState } from "react";

import { api, ApiError } from "../api";
import { AuthLayout } from "../components/AuthLayout";
import { Field, SubmitButton } from "../components/Field";
import { strings } from "../strings";

const s = strings.signIn;

export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
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
      if (!(err instanceof ApiError)) setError(strings.errors.unreachable);
      else if (err.status === 401) setError(s.invalid);
      else if (err.status === 429) setError(strings.errors.rateLimited);
      else setError(strings.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="text-2xl font-bold">{s.title}</h1>
      {error && (
        <div ref={errorRef} tabIndex={-1} role="alert" className="mt-4 rounded-md border border-red-700 bg-red-50 p-3 text-sm text-red-800 outline-none">
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
