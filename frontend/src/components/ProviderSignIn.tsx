import { useEffect, useRef, useState } from "react";

import { api, ApiError } from "../api";
import type { Messages } from "../i18n/en";
import { useStrings } from "../i18n/LocaleProvider";
import type { OidcProvider } from "../instance";
import { leavePage } from "../lib/sign-in";
import { PendingButton } from "./form/PendingButton";
import { Alert } from "./ui/alert";

/** A failed sign-in at the provider: the code from the address or the API, and the wait Retry-After gave. */
export type ProviderError = { code: string; retryAfter?: number | null };

/** Return the error a failed start of the provider sign-in shows; a request that never reached the server is `unreachable`. */
function errorOf(err: unknown): ProviderError {
  if (!(err instanceof ApiError)) return { code: "unreachable" };
  return { code: err.status === 429 ? "rate_limited" : err.body.code, retryAfter: err.retryAfter };
}

/** Return the text of a provider sign-in error, and whether it offers a Retry button (unknown codes only). */
function describe(error: ProviderError, provider: OidcProvider, m: Messages): { text: string; retry: boolean } {
  const e = m.signIn.providerErrors;
  switch (error.code) {
    case "not_allowed":
    case "access_denied":
      return { text: e.notAllowed, retry: false };
    case "account_not_linked":
    case "email_in_use":
      return { text: e.emailInUse, retry: false };
    case "account_disabled":
      return { text: m.signIn.accountDisabled, retry: false };
    case "provider_unavailable":
      return { text: e.providerUnavailable(provider.name), retry: false };
    case "rate_limited":
      return { text: e.rateLimited(error.retryAfter ?? null), retry: false };
    case "unreachable":
      return { text: m.errors.unreachable, retry: false };
    default:
      return { text: e.failed, retry: true };
  }
}

type ProviderSignInProps = {
  provider: OidcProvider;
  /** Error the server sent back in the address, shown focused. */
  error?: ProviderError | null;
  /** Start the sign-in at the provider on mount, replacing this page in the history. */
  autoRedirect?: boolean;
  /** Path to land on once signed in. */
  returnTo?: string;
};

/**
 * Render the button that signs in at the identity provider, with the error of a failed attempt above it.
 *
 * An automatic start happens at most once per mount and never after a failed start. An error from the address blocks
 * it until the parent drops that error on the next navigation, so a provider that keeps refusing cannot cause a
 * redirect loop.
 */
export function ProviderSignIn({ provider, error: initialError = null, autoRedirect = false, returnTo }: ProviderSignInProps) {
  const m = useStrings();
  const s = m.signIn;
  const [error, setError] = useState<ProviderError | null>(initialError);
  // The parent drops the address's error on the next navigation; the page stays mounted, so follow it here.
  const [givenError, setGivenError] = useState(initialError);
  if (initialError !== givenError) {
    setGivenError(initialError);
    setError(initialError);
  }
  const [failures, setFailures] = useState(0);
  const [pending, setPending] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const started = useRef(false);

  async function start(auto: boolean) {
    if (auto) setRedirecting(true);
    else setPending(true);
    try {
      const { url } = await api.signInWithProvider(returnTo);
      // The automatic start replaces this page, so Back from the provider does not land on it and start again.
      if (auto) leavePage.replace(url);
      else leavePage.assign(url);
    } catch (err) {
      setError(errorOf(err));
      setFailures((n) => n + 1);
      setPending(false);
      setRedirecting(false);
    }
  }

  useEffect(() => {
    if (!autoRedirect || started.current || initialError) return;
    started.current = true;
    void start(true);
    // Started once per mount: a new `returnTo` must not start it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRedirect, initialError]);

  // A page restored from the back-forward cache keeps its state: give the button back instead of a stuck progress.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setPending(false);
      setRedirecting(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  // The error stays while a new attempt runs; after an unexplained failure the button says "Try again".
  const shown = error && describe(error, provider, m);
  return (
    <div className="flex flex-col gap-4">
      {shown && (
        <Alert key={failures} variant="destructive" autoFocus>
          {shown.text}
        </Alert>
      )}
      {redirecting ? (
        <p role="status" className="text-sm">
          {s.redirecting(provider.name)}
        </p>
      ) : (
        <PendingButton
          type="button"
          className="h-auto min-h-10 w-full whitespace-normal"
          pending={pending}
          pendingLabel={s.redirecting(provider.name)}
          onClick={() => void start(false)}
        >
          {shown?.retry ? m.retry : s.withProvider(provider.name)}
        </PendingButton>
      )}
    </div>
  );
}

/** Render the "or" between the provider button and the password form. */
export function OrDivider() {
  const s = useStrings().signIn;
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      <span>{s.or}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}
