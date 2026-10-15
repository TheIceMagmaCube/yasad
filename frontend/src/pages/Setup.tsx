import { type FormEvent, useEffect, useRef, useState } from "react";

import { type AdminInput, api, ApiError, type User } from "../api";
import { AuthLayout } from "../components/AuthLayout";
import { Field, SubmitButton } from "../components/Field";
import { strings } from "../strings";

type Step = "code" | "admin" | "done";
type FieldErrors = Partial<Record<keyof AdminInput, string>>;

const s = strings.setup;
const EMPTY_ADMIN: AdminInput = { name: "", email: "", password: "", passwordConfirm: "" };

/** Return the message for an API error on the setup code. */
function codeError(err: unknown): string {
  if (!(err instanceof ApiError)) return strings.errors.unreachable;
  if (err.body.code === "invalid_code") return s.invalidCode(err.body.attemptsLeft ?? 0);
  if (err.body.code === "rate_limited") return strings.errors.rateLimited;
  if (err.body.code === "setup_closed") return s.closed;
  return strings.errors.generic;
}

function Steps({ step }: { step: Step }) {
  const items = [
    { key: "code", label: s.steps.code },
    { key: "admin", label: s.steps.admin },
  ] as const;
  const current = step === "code" ? 0 : 1;
  return (
    <ol className="mt-3 flex gap-2 text-xs">
      {items.map((item, i) => (
        <li
          key={item.key}
          aria-current={i === current ? "step" : undefined}
          className={`flex-1 border-t-4 pt-1 ${
            i < current ? "border-green-700 text-green-800" : i === current ? "border-zinc-900 font-semibold" : "border-zinc-300 text-zinc-600"
          }`}
        >
          <span className="sr-only">{s.stepLabel(i + 1, items.length)}: </span>
          {i < current ? "✓ " : `${i + 1}. `}
          {item.label}
        </li>
      ))}
    </ol>
  );
}

export function Setup({ onDone, onClosed }: { onDone: () => void; onClosed: () => void }) {
  const [step, setStep] = useState<Step>("code");
  const [code, setCode] = useState("");
  const [admin, setAdmin] = useState<AdminInput>(EMPTY_ADMIN);
  const [error, setError] = useState<{ text: string; n: number } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<User | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  /** Show an error and move the focus to it, even when the message repeats. */
  const fail = (text: string) => setError((prev) => ({ text, n: (prev?.n ?? 0) + 1 }));

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.verifyCode(code);
      setError(null);
      setStep("admin");
    } catch (err) {
      if (err instanceof ApiError && err.body.code === "setup_closed") onClosed();
      else fail(codeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitAdmin(e: FormEvent) {
    e.preventDefault();
    const local: FieldErrors = {};
    if (admin.password.length < 12) local.password = s.passwordTooShort;
    if (admin.passwordConfirm !== admin.password) local.passwordConfirm = s.passwordMismatch;
    setFieldErrors(local);
    if (Object.keys(local).length > 0) return fail(s.checkFields);

    setBusy(true);
    try {
      const { user } = await api.completeSetup(code, admin);
      setError(null);
      setCreated(user);
      setStep("done");
    } catch (err) {
      if (err instanceof ApiError && err.body.code === "invalid_input") {
        setFieldErrors(err.body.fields ?? {});
        fail(s.checkFields);
      } else if (err instanceof ApiError && err.body.code === "invalid_code") {
        setStep("code");
        fail(codeError(err));
      } else if (err instanceof ApiError && err.body.code === "setup_closed") {
        onClosed();
      } else {
        fail(codeError(err));
      }
    } finally {
      setBusy(false);
    }
  }

  const update = (key: keyof AdminInput) => (e: { target: { value: string } }) =>
    setAdmin((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <AuthLayout>
      <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold outline-none">
        {step === "done" ? s.doneTitle : s.title}
      </h1>
      {step !== "done" && <Steps step={step} />}

      {error && (
        <div ref={errorRef} tabIndex={-1} role="alert" className="mt-4 rounded-md border border-red-700 bg-red-50 p-3 text-sm text-red-800 outline-none">
          {error.text}
        </div>
      )}

      {step === "code" && (
        <form onSubmit={submitCode} noValidate>
          <p className="mt-4 text-sm text-zinc-700">{s.codeHint}</p>
          <Field
            id="code"
            label={s.codeLabel}
            type="password"
            autoComplete="off"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <SubmitButton busy={busy}>{s.continue}</SubmitButton>
        </form>
      )}

      {step === "admin" && (
        <form onSubmit={submitAdmin} noValidate>
          <Field id="name" label={s.name} autoComplete="name" required value={admin.name} onChange={update("name")} error={fieldErrors.name} />
          <Field
            id="email"
            label={s.email}
            type="email"
            autoComplete="email"
            required
            value={admin.email}
            onChange={update("email")}
            error={fieldErrors.email}
          />
          <Field
            id="password"
            label={s.password}
            type="password"
            autoComplete="new-password"
            required
            hint={s.passwordHint}
            value={admin.password}
            onChange={update("password")}
            error={fieldErrors.password}
          />
          <Field
            id="passwordConfirm"
            label={s.passwordConfirm}
            type="password"
            autoComplete="new-password"
            required
            value={admin.passwordConfirm}
            onChange={update("passwordConfirm")}
            error={fieldErrors.passwordConfirm}
          />
          <SubmitButton busy={busy}>{s.create}</SubmitButton>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setStep("code");
            }}
            className="mt-3 w-full text-sm text-zinc-700 underline outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
          >
            {strings.back}
          </button>
        </form>
      )}

      {step === "done" && created && (
        <div>
          <p className="mt-4 rounded-md border border-green-700 bg-green-50 p-3 text-sm text-green-900">{s.doneSignedIn(created.name)}</p>
          <p className="mt-3 rounded-md border border-amber-600 bg-amber-50 p-3 text-sm text-amber-950">
            <strong>{s.doneNoticeTitle}</strong> {s.doneNotice}
          </p>
          <button
            type="button"
            onClick={onDone}
            className="mt-6 w-full rounded-md bg-zinc-900 px-4 py-2 font-semibold text-white outline-none hover:bg-zinc-700 focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          >
            {s.goToApp}
          </button>
        </div>
      )}
    </AuthLayout>
  );
}
