import { type FormEvent, useState } from "react";

import { api, ApiError } from "../api";
import { AuthHero } from "../components/AuthHero";
import { AuthLayout } from "../components/AuthLayout";
import { ErrorSummary } from "../components/form/ErrorSummary";
import { Field } from "../components/form/Field";
import { FormActions, FormStack } from "../components/form/FormLayout";
import { PasswordField } from "../components/form/PasswordField";
import { SubmitButton } from "../components/form/PendingButton";
import { Link } from "../components/Link";
import { OrDivider, type ProviderError, ProviderSignIn } from "../components/ProviderSignIn";
import { Alert } from "../components/ui/alert";
import { buttonVariants } from "../components/ui/button";
import { useStrings } from "../i18n/LocaleProvider";
import { useInstance } from "../instance";
import { useFormErrors } from "../lib/form-errors";
import { useDocumentTitle } from "../lib/page";
import { usePath } from "../lib/router";
import { LOCAL_SIGN_IN, returnToFor } from "../lib/sign-in";

const FIELDS = ["email", "password"] as const;

/** Return the title of the sign-in screen: admin-only form, password sign-in off with no provider, or plain sign-in. */
function useTitle(passwordSignIn: boolean, local: boolean, oidc: boolean): string {
  const s = useStrings().signIn;
  if (passwordSignIn) return s.title;
  if (local) return s.localTitle;
  return oidc ? s.title : s.disabledTitle;
}

type SignInProps = {
  onSignedIn: () => void;
  /** The /sign-in/local path: the form stays available to local admins when password sign-in is off. */
  local?: boolean;
  /** The session this browser had has just ended: say so, focused, above the form. */
  expired?: boolean;
  /** Some links are open to everyone, so "/" shows them. */
  publicHome?: boolean;
  /** Error the server sent back from the identity provider (`?error=`), shown focused. */
  error?: ProviderError | null;
  /** Start the sign-in at the identity provider at once; the caller decides when it is allowed. */
  autoRedirect?: boolean;
};

/**
 * Sign-in screen: the identity provider's button first when OIDC is configured, then the password form. With
 * password sign-in off, the default path shows no form but links to /sign-in/local, which still shows it; the server
 * accepts it for local admins only.
 */
export function SignIn({ onSignedIn, local = false, expired = false, publicHome = false, error = null, autoRedirect = false }: SignInProps) {
  const m = useStrings();
  const s = m.signIn;
  const { passwordSignIn, oidc } = useInstance();
  const path = usePath();
  const title = useTitle(passwordSignIn, local, Boolean(oidc));
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
      // Only wrong credentials empty the password: the summary then links to it to type it again.
      if (err instanceof ApiError && err.body.code === "INVALID_EMAIL_OR_PASSWORD") setPassword("");
    } finally {
      setBusy(false);
    }
  }

  const provider = oidc && (
    <ProviderSignIn provider={oidc} error={error} autoRedirect={autoRedirect} returnTo={returnToFor(path)} />
  );

  if (!passwordSignIn && !local) {
    return (
      <AuthLayout>
        <AuthHero title={title} lines={s.greetings} />
        {oidc ? (
          <div className="mt-6 flex flex-col gap-4">
            {expired && (
              <Alert variant="warning" autoFocus>
                {s.expired}
              </Alert>
            )}
            {provider}
          </div>
        ) : (
          <p className="mt-3">{s.disabled}</p>
        )}
        <div className="mt-6 flex flex-col items-start gap-3">
          <Link href={LOCAL_SIGN_IN} className={buttonVariants({ variant: "outline", className: "h-auto min-h-11 whitespace-normal" })}>
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
      <AuthHero title={title} lines={s.greetings} />
      {!passwordSignIn && <p className="mt-2 text-sm text-muted-foreground">{s.adminsOnly}</p>}
      {expired && !submitted && (
        <Alert variant="warning" autoFocus className="mt-6">
          {s.expired}
        </Alert>
      )}
      {provider && (
        <div className="mt-6 flex flex-col gap-6">
          {provider}
          <OrDivider />
        </div>
      )}
      <form onSubmit={submit} noValidate className="mt-6">
        <FormStack>
          <ErrorSummary errors={errors} labels={{ email: s.email, password: s.password }} />
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
            {/* With a provider, its button is the one main action; the password form is the second way in. */}
            <SubmitButton variant={provider ? "outline" : "default"} pending={busy} pendingLabel={s.submitting}>
              {s.submit}
            </SubmitButton>
          </FormActions>
        </FormStack>
      </form>
    </AuthLayout>
  );
}
