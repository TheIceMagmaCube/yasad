import { Check } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { type AdminInput, api, ApiError, type User } from "../api";
import { AuthLayout } from "../components/AuthLayout";
import { ErrorSummary } from "../components/form/ErrorSummary";
import { Field } from "../components/form/Field";
import { FormActions, FormStack } from "../components/form/FormLayout";
import { PasswordField } from "../components/form/PasswordField";
import { SubmitButton } from "../components/form/PendingButton";
import { OrDivider, type ProviderError, ProviderSignIn } from "../components/ProviderSignIn";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import type { Messages } from "../i18n/en";
import { useStrings } from "../i18n/LocaleProvider";
import { useInstance } from "../instance";
import { focusPage } from "../lib/focus";
import { type CodeRule, confirmationProblem, newPasswordProblem, useFormErrors } from "../lib/form-errors";
import { useDocumentTitle } from "../lib/page";

type Step = "code" | "admin" | "done" | "closed";

const CODE_FIELDS = ["code"] as const;
const ADMIN_FIELDS = ["name", "email", "password", "passwordConfirm"] as const satisfies readonly (keyof AdminInput)[];
const EMPTY_ADMIN: AdminInput = { name: "", email: "", password: "", passwordConfirm: "" };

/** Return how a wrong setup code shows: on the code field, with the attempts left. */
function codeRules(m: Messages): Record<string, CodeRule<"code">> {
  return { invalid_code: { field: "code", message: (err: ApiError) => m.setup.invalidCode(err.body.attemptsLeft ?? 0) } };
}

/** Return whether the API says setup is closed (an administrator exists). */
const isClosed = (err: unknown) => err instanceof ApiError && err.body.code === "setup_closed";

/** Ordered list of the setup steps: done ones muted with a check, the current one marked. */
function Steps({ step }: { step: "code" | "admin" }) {
  const s = useStrings().setup;
  const items = [
    { key: "code", label: s.steps.code },
    { key: "admin", label: s.steps.admin },
  ] as const;
  const current = step === "code" ? 0 : 1;
  return (
    <ol aria-label={s.progress} className="mt-3 flex gap-2 text-sm">
      {items.map((item, i) => (
        <li
          key={item.key}
          aria-current={i === current ? "step" : undefined}
          className={cn(
            "flex flex-1 items-center gap-1.5 border-t-4 pt-1.5",
            i < current && "border-primary/40 text-muted-foreground",
            i === current && "border-primary font-semibold",
            i > current && "border-border text-muted-foreground",
          )}
        >
          {i < current && <Check aria-hidden="true" className="size-4 shrink-0" />}
          <span>
            <span className="sr-only">{s.stepLabel(i + 1, items.length)}: </span>
            {item.label}
            {i < current && <span className="sr-only">, {s.stepDone}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Return the title of a step, for the heading and the document title. */
function stepTitle(step: Step, s: Messages["setup"]): string {
  if (step === "done") return s.doneTitle;
  if (step === "closed") return s.closedTitle;
  return s.title;
}

type SetupProps = {
  onDone: () => void;
  onClosed: () => void;
  /** Error the server sent back from the identity provider (`?error=`), shown above its button. */
  providerError?: ProviderError | null;
};

/**
 * First-run setup: the setup code, then the first administrator, then a final notice. `onDone` opens the app
 * (signed in); `onClosed` goes to sign-in when an administrator already exists.
 *
 * With OIDC configured, the first step also offers the provider's button, never started by itself: setup must stay
 * reachable, and people of the provider can sign in before any local administrator exists.
 */
export function Setup({ onDone, onClosed, providerError = null }: SetupProps) {
  const m = useStrings();
  const s = m.setup;
  const { oidc } = useInstance();
  const [step, setStep] = useState<Step>("code");
  const [code, setCode] = useState("");
  const [admin, setAdmin] = useState<AdminInput>(EMPTY_ADMIN);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<User | null>(null);
  const codeErrors = useFormErrors(CODE_FIELDS, "setup");
  const adminErrors = useFormErrors(ADMIN_FIELDS, "setup-admin");
  const previousStep = useRef(step);
  useDocumentTitle(...(step === "code" || step === "admin" ? [s.steps[step], s.title] : [stepTitle(step, s)]));

  // A new step focuses the heading, unless an error summary of the same commit took the focus.
  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    focusPage();
  }, [step]);

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    if (!codeErrors.check({ code: code.trim() === "" && m.fieldErrors.required })) return;
    setBusy(true);
    try {
      await api.verifyCode(code);
      setStep("admin");
    } catch (err) {
      if (isClosed(err)) setStep("closed");
      else codeErrors.failWith(err, { codes: codeRules(m) });
    } finally {
      setBusy(false);
    }
  }

  async function submitAdmin(e: FormEvent) {
    e.preventDefault();
    const ok = adminErrors.check({
      name: admin.name.trim() === "" && m.fieldErrors.required,
      email: admin.email.trim() === "" && m.fieldErrors.required,
      password: newPasswordProblem(admin.password, m),
      passwordConfirm: confirmationProblem(admin.password, admin.passwordConfirm, m),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { user } = await api.completeSetup(code, admin);
      setCreated(user);
      setStep("done");
    } catch (err) {
      if (isClosed(err)) setStep("closed");
      else if (err instanceof ApiError && err.body.code === "invalid_code") {
        adminErrors.reset();
        setStep("code");
        codeErrors.failWith(err, { codes: codeRules(m) });
      } else adminErrors.failWith(err);
    } finally {
      setBusy(false);
    }
  }

  const update = (key: keyof AdminInput) => (e: { target: { value: string } }) => setAdmin((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <AuthLayout>
      <h1 tabIndex={-1} className="text-title outline-none">
        {stepTitle(step, s)}
      </h1>
      {(step === "code" || step === "admin") && <Steps step={step} />}

      {step === "code" && (
        <form onSubmit={submitCode} noValidate className="mt-6">
          <FormStack>
            <ErrorSummary errors={codeErrors} />
            <Field
              label={s.codeLabel}
              hint={s.codeHint}
              type="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              data-select-on-error=""
              required
              inputClassName="font-mono"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              {...codeErrors.field("code")}
            />
            <FormActions stretch>
              <SubmitButton pending={busy} pendingLabel={s.verifying}>
                {s.continue}
              </SubmitButton>
            </FormActions>
          </FormStack>
        </form>
      )}
      {step === "code" && oidc && (
        <div className="mt-6 flex flex-col gap-6">
          <OrDivider />
          <ProviderSignIn provider={oidc} error={providerError} />
        </div>
      )}

      {step === "admin" && (
        <form onSubmit={submitAdmin} noValidate className="mt-6">
          <FormStack>
            <ErrorSummary errors={adminErrors} labels={{ name: s.name, email: s.email, password: s.password, passwordConfirm: s.passwordConfirm }} />
            <Field label={s.name} autoComplete="name" required value={admin.name} onChange={update("name")} {...adminErrors.field("name")} />
            <Field label={s.email} type="email" autoComplete="email" required value={admin.email} onChange={update("email")} {...adminErrors.field("email")} />
            <PasswordField
              label={s.password}
              autoComplete="new-password"
              required
              hint={s.passwordHint}
              value={admin.password}
              onChange={update("password")}
              {...adminErrors.field("password")}
            />
            <PasswordField
              label={s.passwordConfirm}
              autoComplete="new-password"
              required
              value={admin.passwordConfirm}
              onChange={update("passwordConfirm")}
              {...adminErrors.field("passwordConfirm")}
            />
            <FormActions stretch>
              <SubmitButton pending={busy} pendingLabel={s.creating}>
                {s.create}
              </SubmitButton>
              <Button
                type="button"
                variant="link"
                onClick={() => {
                  adminErrors.reset();
                  setStep("code");
                }}
              >
                {m.back}
              </Button>
            </FormActions>
          </FormStack>
        </form>
      )}

      {step === "done" && created && (
        <div className="mt-6 flex flex-col gap-4">
          <Alert variant="success">{s.doneSignedIn(created.name)}</Alert>
          <Alert variant="warning" role="note" title={s.doneNoticeTitle}>
            {s.doneNotice}
          </Alert>
          <Button type="button" onClick={onDone} className="mt-2 w-full">
            {s.goToApp}
          </Button>
        </div>
      )}

      {step === "closed" && (
        <div className="mt-4 flex flex-col gap-6">
          <p>{s.closedBody}</p>
          <Button type="button" onClick={onClosed} className="w-full">
            {s.goToSignIn}
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}
