import { AuthLayout } from "../components/AuthLayout";
import { Link } from "../components/Link";
import { ProviderSignIn } from "../components/ProviderSignIn";
import { buttonVariants } from "../components/ui/button";
import { useStrings } from "../i18n/LocaleProvider";
import { useInstance } from "../instance";
import { useDocumentTitle } from "../lib/page";
import { LOCAL_SIGN_IN, SIGN_IN } from "../lib/sign-in";

const LINK = "h-auto min-h-10 whitespace-normal";

/**
 * Page reached after signing out with OIDC configured, and the provider's return address after its own sign-out.
 * It never starts a sign-in by itself: with a provider that keeps its session, that would sign the person in again.
 */
export function SignedOut() {
  const m = useStrings();
  const s = m.signedOut;
  const { passwordSignIn, oidc } = useInstance();
  useDocumentTitle(s.title);
  return (
    <AuthLayout>
      <h1 tabIndex={-1} className="text-title outline-none">
        {s.title}
      </h1>
      <p className="mt-3">{s.body}</p>
      <div className="mt-6 flex flex-col gap-4">
        {oidc && <ProviderSignIn provider={oidc} />}
        {!oidc ? (
          <Link href={SIGN_IN} className={buttonVariants({ className: `w-full ${LINK}` })}>
            {s.signInAgain}
          </Link>
        ) : passwordSignIn ? (
          <Link href={SIGN_IN} className={buttonVariants({ variant: "outline", className: LINK })}>
            {s.withPassword}
          </Link>
        ) : (
          <Link href={LOCAL_SIGN_IN} className={buttonVariants({ variant: "outline", className: LINK })}>
            {m.signIn.adminSignIn}
          </Link>
        )}
      </div>
    </AuthLayout>
  );
}
