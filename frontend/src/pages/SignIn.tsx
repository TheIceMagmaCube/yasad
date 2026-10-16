import { type FormEvent, useState } from "react";

import { api } from "../api";
import { AuthLayout } from "../components/AuthLayout";
import { ErrorSummary } from "../components/form/ErrorSummary";
import { Field } from "../components/form/Field";
import { FormActions, FormStack } from "../components/form/FormLayout";
import { PasswordField } from "../components/form/PasswordField";
import { SubmitButton } from "../components/form/PendingButton";
import { Link } from "../components/Link";
import { Alert } from "../components/ui/alert";
import { buttonVariants } from "../components/ui/button";
import { useStrings } from "../i18n/LocaleProvider";
import { useInstance } from "../instance";
import { useFormErrors } from "../lib/form-errors";
import { useDocumentTitle } from "../lib/page";

const FIELDS = ["email", "password"] as const;

/** Return the title of the sign-in screen: password sign-in off, admin-only, or the plain form. */
function useTitle(passwordSignIn: boolean, local: boolean): string {
  const s = useStrings().signIn;
  if (passwordSignIn) return s.title;
  return local ? s.localTitle : s.disabledTitle;
}

type SignInProps = {
  onSignedIn: () => void;
  /** The /sign-in/local path: the form stays available to local admins when password sign-in is off. */
  local?: boolean;
  /** The session this browser had has just ended: say so, focused, above the form. */
  expired?: boolean;
  /** Some links are open to everyone, so "/" shows them. */
  publicHome?: boolean;
};

/**
 * Sign-in screen. With password sign-in off, the default path only says so and links to /sign-in/local, which
 * still shows the form; the server accepts it for local admins only.
 */
export function SignIn({ onSignedIn, local = false, expired = false, publicHome = false }: SignInProps) {
  const m = useStrings();
  const s = m.signIn;
  const { passwordSignIn } = useInstance();
  const title = useTitle(passwordSignIn, local);
  useDocumentTitle(title);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const errors = useFormErrors(FIELDS, "sign-in");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    const ok = errors.check({ email: email.trim() === "" && m.fieldErrors.required, password: password === "" && m.fieldErrors.required });
    if (!ok) return;
    setBusy(true);
    try {
      await api.signIn(email, password);
      onSignedIn();
    } catch (err) {
      errors.failWith(err, {
        codes: {
          INVALID_EMAIL_OR_PASSWORD: { message: s.invalid, invalid: ["email", "password"], link: { field: "password", message: s.retypePassword } },
          INVALID_EMAIL: { message: m.fieldErrors.invalid_email, field: "email" },
          account_disabled: { message: s.accountDisabled },
        },
      });
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  if (!passwordSignIn && !local) {
    return (
      <AuthLayout>
        <h1 tabIndex={-1} className="text-title outline-none">
          {title}
        </h1>
        <p className="mt-3">{s.disabled}</p>
        <div className="mt-6 flex flex-col items-start gap-3">
          <Link href="/sign-in/local" className={buttonVariants({ variant: "outline", className: "h-auto min-h-10 whitespace-normal" })}>
            {s.adminSignIn}
          </Link>
          {publicHome && (
            <Link href="/" className={buttonVariants({ variant: "link", className: "px-0" })}>
              {s.backToLinks}
            </Link>
          )}
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 tabIndex={-1} className="text-title outline-none">
        {title}
      </h1>
      {!passwordSignIn && <p className="mt-2 text-sm text-muted-foreground">{s.adminsOnly}</p>}
      <form onSubmit={submit} noValidate className="mt-6">
        <FormStack>
          {expired && !submitted && (
            <Alert variant="warning" autoFocus>
              {s.expired}
            </Alert>
          )}
          <ErrorSummary errors={errors} />
          <Field label={s.email} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} {...errors.field("email")} />
          <PasswordField
            label={s.password}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            {...errors.field("password")}
          />
          <FormActions stretch>
            <SubmitButton pending={busy} pendingLabel={s.submitting}>
              {s.submit}
            </SubmitButton>
          </FormActions>
        </FormStack>
      </form>
    </AuthLayout>
  );
}
