/** Path of the sign-in screen when "/" shows the public links. */
export const SIGN_IN = "/sign-in";
/** Path showing the password form even when password sign-in is off (local admins only). */
export const LOCAL_SIGN_IN = "/sign-in/local";
/** Landing page after a sign-out with OIDC configured; the provider sends the browser back there too. */
export const SIGNED_OUT = "/signed-out";

const SIGN_IN_PATHS = new Set([SIGN_IN, LOCAL_SIGN_IN, SIGNED_OUT]);

/** Return the path to come back to after signing in at the provider: the current one, unless it is a sign-in path. */
export function returnToFor(path: string): string | undefined {
  return SIGN_IN_PATHS.has(path) ? undefined : path;
}

/** Return the sign-in error code the server put in the address (`?error=`), or null. */
export function readSignInError(search: string): string | null {
  const code = new URLSearchParams(search).get("error");
  return code ? code : null;
}

/** Remove `?error=` from the address without a new history entry, so a reload does not show the error again. */
export function clearSignInError(): void {
  const url = new URL(location.href);
  if (!url.searchParams.has("error")) return;
  url.searchParams.delete("error");
  history.replaceState(history.state, "", url.href);
}

/**
 * Leave the app for another site (the identity provider). Kept in one object so tests can watch it: jsdom cannot
 * navigate away, and its `location` cannot be replaced.
 */
export const leavePage = {
  /** Go to `url`, keeping this page in the history. */
  assign(url: string): void {
    location.assign(url);
  },
  /** Go to `url` in place of this page, so Back from there skips it. */
  replace(url: string): void {
    location.replace(url);
  },
};
