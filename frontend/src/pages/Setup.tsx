import { type FormEvent, useEffect, useRef, useState } from "react";

import { type AdminInput, api, ApiError, type User } from "../api";
import { AuthLayout } from "../components/AuthLayout";
import { Field, SubmitButton } from "../components/Field";
import { Button } from "../components/ui/button";
import type { Messages } from "../i18n/en";
import { errorMessage, fieldErrorMessage } from "../i18n/errors";
import { useStrings } from "../i18n/LocaleProvider";

type Step = "code" | "admin" | "done";
type FieldErrors = Partial<Record<keyof AdminInput, string>>;

const FIELD_ORDER: (keyof AdminInput)[] = ["name", "email", "password", "passwordConfirm"];
const EMPTY_ADMIN: AdminInput = { name: "", email: "", password: "", passwordConfirm: "" };

/** Return the message for an API error on the setup code. */
function codeError(err: unknown, m: Messages): string {
  if (err instanceof ApiError && err.body.code === "invalid_code") return m.setup.invalidCode(err.body.attemptsLeft ?? 0);
  if (err instanceof ApiError && err.body.code === "setup_closed") return m.setup.closed;
  return errorMessage(err, m);
}

function Steps({ step }: { step: Step }) {
  const s = useStrings().setup;
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
            i < current ? "border-primary" : i === current ? "border-primary font-semibold" : "border-border text-muted-foreground"
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
  const m = useStrings();
  const s = m.setup;
  const [step, setStep] = useState<Step>("code");
  const [code, setCode] = useState("");
  const [admin, setAdmin] = useState<AdminInput>(EMPTY_ADMIN);
  const [error, setError] = useState<{ text: string; fields: FieldErrors; n: number } | null>(null);
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

  /** Show an error summary and move the focus to it, even when the message repeats. */
  const fail = (text: string, fields: FieldErrors = {}) => setError((prev) => ({ text, fields, n: (prev?.n ?? 0) + 1 }));

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.verifyCode(code);
      setError(null);
      setStep("admin");
    } catch (err) {
      fail(codeError(err, m));
      if (err instanceof ApiError && err.body.code === "setup_closed") onClosed();
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
    if (Object.keys(local).length > 0) return fail(s.checkFields, local);

    setBusy(true);
    try {
      const { user } = await api.completeSetup(code, admin);
      setError(null);
      setCreated(user);
      setStep("done");
    } catch (err) {
      if (err instanceof ApiError && err.body.code === "invalid_input") {
        const fields = Object.fromEntries(Object.entries(err.body.fields ?? {}).map(([id, code]) => [id, fieldErrorMessage(code, m)]));
        setFieldErrors(fields);
        fail(s.checkFields, fields);
      } else if (err instanceof ApiError && err.body.code === "invalid_code") {
        setStep("code");
        fail(codeError(err, m));
      } else {
        fail(codeError(err, m));
        if (err instanceof ApiError && err.body.code === "setup_closed") onClosed();
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
        <div ref={errorRef} tabIndex={-1} role="alert" className="mt-4 rounded-md border border-destructive p-3 text-sm text-destructive outline-none">
          <p>{error.text}</p>
          {FIELD_ORDER.some((id) => error.fields[id]) && (
            <ul className="mt-2 list-disc pl-5">
              {FIELD_ORDER.filter((id) => error.fields[id]).map((id) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(id)?.focus();
                    }}
                    className="underline"
                  >
                    {error.fields[id]}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {step === "code" && (
        <form onSubmit={submitCode} noValidate>
          <p className="mt-4 text-sm text-muted-foreground">{s.codeHint}</p>
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
          <Button
            type="button"
            variant="link"
            onClick={() => {
              setError(null);
              setStep("code");
            }}
            className="mt-3 w-full"
          >
            {m.back}
          </Button>
        </form>
      )}

      {step === "done" && created && (
        <div>
          <p className="mt-4 rounded-md border border-primary p-3 text-sm">{s.doneSignedIn(created.name)}</p>
          <p className="mt-3 rounded-md border-2 border-primary bg-muted p-3 text-sm">
            <strong>{s.doneNoticeTitle}</strong> {s.doneNotice}
          </p>
          <Button type="button" onClick={onDone} className="mt-6 w-full">
            {s.goToApp}
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}
