import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, ApiError, onStaleSession, type SetupState, type User } from "./api";
import { AppShell } from "./components/AppShell";
import { LoadingShell } from "./components/LoadingShell";
import { type Notice, ShellNoticeProvider } from "./components/ShellNotice";
import { type ProviderError } from "./components/ProviderSignIn";
import { LocaleProvider } from "./i18n/LocaleProvider";
import { cachedInstance, cacheInstance, type Instance, InstanceContext, useInstance } from "./instance";
import { invalidateHome, onViewerChanged, primeHome } from "./lib/home-store";
import { AnnouncerProvider } from "./lib/announcer";
import { useFocusOnNavigation, useFocusOnViewChange } from "./lib/focus";
import { navigate, normalizePath, useNavigations, usePath } from "./lib/router";
import { clearSignInError, leavePage, LOCAL_SIGN_IN, readSignInError, SIGN_IN, SIGNED_OUT } from "./lib/sign-in";
import { Account } from "./pages/Account";
import { AdminRoutes, canonicalAdminPath } from "./pages/admin/AdminRoutes";
import { NotFound } from "./pages/ErrorViews";
import { Home } from "./pages/Home";
import { Setup } from "./pages/Setup";
import { SignedOut } from "./pages/SignedOut";
import { SignIn } from "./pages/SignIn";
import { TemporaryPassword } from "./pages/TemporaryPassword";
import { Unreachable } from "./pages/Unreachable";
import { ThemeProvider } from "./theme/ThemeProvider";

type View =
  | { name: "loading" }
  | { name: "error" }
  | { name: "setup" }
  | { name: "signIn" }
  /** Nobody signed in, and some links are open to everyone: "/" shows them. */
  | { name: "public" }
  | { name: "home"; user: User };

/** Treat the setup state as closed when the API waits for a temporary password to be replaced. */
function passwordChangePending(err: unknown): SetupState {
  if (err instanceof ApiError && err.body.code === "password_change_required") return { open: false };
  throw err;
}

/**
 * Return whether some links are open to everyone, storing them in the home store for the anonymous home; a
 * failure, or an answer for a session opened meanwhile, also gives false, so sign-in stays reachable.
 */
async function loadPublicHome(): Promise<boolean> {
  try {
    const home = await api.home();
    if (home.categories.length === 0) return false;
    return primeHome("anonymous", home);
  } catch {
    return false;
  }
}

/**
 * Return the screen to show: setup while open and nobody is signed in, then home for a signed-in person, else the
 * public links or sign-in. The public links are asked for only once the session is known to be empty.
 */
async function loadView(): Promise<View> {
  let setup: SetupState;
  let user: User | null;
  try {
    [setup, user] = await Promise.all([api.setupState().catch(passwordChangePending), api.session()]);
  } catch {
    return { name: "error" };
  }
  if (setup.open && !user) return { name: "setup" };
  if (user) return { name: "home", user };
  return (await loadPublicHome()) ? { name: "public" } : { name: "signIn" };
}

/** Return the instance settings, keeping the cached ones when the API does not answer. */
async function loadInstance(fallback: Instance): Promise<Instance> {
  try {
    const instance = await api.instance();
    cacheInstance(instance);
    return instance;
  } catch {
    return fallback;
  }
}

/** A notice for the app shell, kept until the next navigation (`navigations` is the count when it was set). */
type ShellNoticeState = Notice & { navigations: number };

export function App() {
  const [instance, setInstance] = useState(cachedInstance);
  const [view, setView] = useState<View>({ name: "loading" });
  /**
   * The navigation count when the session of this browser ended on the server: the sign-in screen says so until
   * the next navigation, or until the shell notice saying the same is closed.
   */
  const [expiredAt, setExpiredAt] = useState<number | null>(null);
  const [notice, setNotice] = useState<ShellNoticeState | null>(null);
  /**
   * The navigation count at the last reload of the session after a session change: the provider sign-in starts by
   * itself only on page load or after a navigation, never on a screen a session change brought (session ended in an
   * open tab, failed sign-out).
   */
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);

  const viewRef = useRef(view);
  const pending = useRef(0);
  const navigations = useNavigations();
  const navigationsRef = useRef(navigations);
  // The provider sign-in error the server put in the address, shown until the next navigation. It is removed
  // from the address at once, so a reload does not show it again.
  const [signInError] = useState(() => readSignInError(location.search));
  const [loadedAt] = useState(navigations);
  useEffect(() => clearSignInError(), []);
  useEffect(() => {
    viewRef.current = view;
    navigationsRef.current = navigations;
  }, [view, navigations]);

  // Every session change goes through here (expired session, sign-in, sign-out, password changed, setup done):
  // the cached home data of the previous viewer is dropped before anything else is shown. Leaving the
  // unreachable screen reloads the instance settings too. With `sessionEnded`, a signed-out view says the session
  // ended. Resolve to the new view.
  const refresh = useCallback(async ({ sessionEnded = false }: { sessionEnded?: boolean } = {}): Promise<View> => {
    invalidateHome();
    pending.current += 1;
    try {
      const leavingError = viewRef.current.name === "error";
      const [next, nextInstance] = await Promise.all([loadView(), leavingError ? loadInstance(cachedInstance()) : null]);
      if (nextInstance) setInstance(nextInstance);
      if (next.name === "home") {
        setExpiredAt(null);
        setNotice((current) => (current?.kind === "sessionExpired" ? null : current));
      } else if (sessionEnded) {
        setExpiredAt(navigationsRef.current);
        if (next.name === "public") setNotice({ kind: "sessionExpired", navigations: navigationsRef.current });
      }
      // Leaving the unreachable screen is still the page load, not a session change: the sign-in may start by itself.
      if (!leavingError) setRefreshedAt(navigationsRef.current);
      setView(next);
      return next;
    } finally {
      pending.current -= 1;
    }
  }, []);

  /** Say that the session ended, then reload it: on the sign-in screen, or as a notice over the public links. */
  const sessionEnded = useCallback(() => void refresh({ sessionEnded: true }), [refresh]);

  // Client-side navigation keeps the session loaded at start: reload it when the API says it changed
  // (signed out, password reset by an admin, admin rights removed), so the right screen replaces the stale one.
  useEffect(
    () =>
      onStaleSession((code) => {
        const current = viewRef.current;
        if (current.name !== "home" || pending.current > 0) return;
        if (code === "password_change_required" && current.user.mustChangePassword) return;
        if (code === "unauthenticated") sessionEnded();
        else void refresh();
      }),
    [refresh, sessionEnded],
  );

  // The home store got an answer for another viewer (signed in or out in another tab, session expired): it
  // dropped it, and the session is reloaded so the screen matches the cookie, whatever the current view.
  useEffect(
    () =>
      onViewerChanged(() => {
        if (pending.current > 0) return;
        if (viewRef.current.name === "home") sessionEnded();
        else void refresh();
      }),
    [refresh, sessionEnded],
  );

  useEffect(() => {
    let active = true;
    void Promise.all([loadInstance(cachedInstance()), loadView()]).then(([nextInstance, nextView]) => {
      if (!active) return;
      setInstance(nextInstance);
      setView(nextView);
    });
    return () => {
      active = false;
    };
  }, []);

  /** Say on the next page that the password was saved, then open the app. */
  const passwordSaved = useCallback(() => {
    setNotice({ kind: "passwordSaved", navigations: navigationsRef.current });
    void refresh();
  }, [refresh]);

  const shownNotice = notice && notice.navigations === navigations ? notice : null;
  const expired = expiredAt === navigations;
  const showError = signInError !== null && navigations === loadedAt;
  const providerError = useMemo(() => (showError ? { code: signInError } : null), [showError, signInError]);
  const autoSignIn = refreshedAt !== navigations;
  const dismissNotice = () => {
    setNotice(null);
    setExpiredAt(null);
  };
  return (
    <InstanceContext value={instance}>
      <LocaleProvider defaultLanguage={instance.defaultLanguage}>
        <ThemeProvider instanceTheme={instance.theme}>
          <AnnouncerProvider>
            <ShellNoticeProvider value={{ notice: shownNotice, onDismiss: dismissNotice }}>
              <Screen
                view={view}
                refresh={refresh}
                expired={expired}
                providerError={providerError}
                autoSignIn={autoSignIn}
                onPasswordSaved={passwordSaved}
              />
            </ShellNoticeProvider>
          </AnnouncerProvider>
        </ThemeProvider>
      </LocaleProvider>
    </InstanceContext>
  );
}

/**
 * Sign out, then leave for the provider's own sign-out when the server gives its address. Otherwise reload the
 * session and, with OIDC configured, land on the signed-out page, which does not sign in again by itself; a
 * failed sign-out only reloads the session.
 */
async function signOutThen(refresh: () => Promise<View>, oidc: boolean): Promise<void> {
  let url: string | undefined;
  try {
    ({ url } = await api.signOut());
  } catch {
    await refresh();
    return;
  }
  if (url) {
    leavePage.assign(url);
    return;
  }
  const next = await refresh();
  if (oidc && next.name !== "home") navigate(SIGNED_OUT);
}

/** Return the canonical form of a path: no trailing slash, and the administration addresses that stand for another. */
function canonicalPath(path: string): string {
  const normalized = normalizePath(path);
  return normalized === "/admin" || normalized.startsWith("/admin/") ? canonicalAdminPath(normalized) : normalized;
}

/** Return the page of a signed-in user for a canonical path; `onProfileChanged` reloads the session. */
function SignedInPage({ user, path, onProfileChanged }: { user: User; path: string; onProfileChanged: () => Promise<unknown> }) {
  if (path === "/") return <Home user={user} />;
  if (path === "/account") return <Account user={user} onProfileChanged={onProfileChanged} />;
  if (path === "/admin" || path.startsWith("/admin/")) return <AdminRoutes path={path} user={user} />;
  return <NotFound />;
}

/**
 * Return the key of a view for the focus rule: the temporary password step, else the view, the person and their
 * role, since a new role can replace the page (administration becomes "Admins only").
 */
function viewKeyOf(view: View): string {
  if (view.name !== "home") return view.name;
  return view.user.mustChangePassword ? "temporary" : `home:${view.user.id}:${view.user.role}`;
}

type ScreenProps = {
  view: View;
  refresh: () => Promise<View>;
  expired: boolean;
  /** Error of a failed sign-in at the identity provider, from the address. */
  providerError: ProviderError | null;
  /** The page was loaded or navigated to since the last session reload; a provider error still stops it. */
  autoSignIn: boolean;
  /** The temporary password was replaced. */
  onPasswordSaved: () => void;
};

function Screen({ view, refresh, expired, providerError, autoSignIn, onPasswordSaved }: ScreenProps) {
  const { passwordSignIn, oidc } = useInstance();
  const rawPath = usePath();
  const path = canonicalPath(rawPath);
  const signedIn = view.name === "home";
  // A signed-in person has nothing to do on the sign-in paths. /sign-in/local only matters with password sign-in
  // off, known once the first view is loaded (the instance settings come with it).
  const signedOut = view.name === "signIn" || view.name === "public";
  const target =
    signedIn && (path === LOCAL_SIGN_IN || path === SIGN_IN || path === SIGNED_OUT)
      ? "/"
      : signedOut && path === LOCAL_SIGN_IN && passwordSignIn
        ? SIGN_IN
        : path;

  useEffect(() => {
    if (target !== rawPath) navigate(target + location.search + location.hash, { replace: true });
  }, [target, rawPath]);

  useFocusOnNavigation();
  useFocusOnViewChange(viewKeyOf(view));

  const reload = () => void refresh();
  // With password sign-in off, the provider is the only way in for everyone but local admins: go there at once.
  const local = path === LOCAL_SIGN_IN;
  const autoRedirect = autoSignIn && Boolean(oidc) && !passwordSignIn && !local;
  const signIn = (
    <SignIn
      local={local}
      expired={expired}
      publicHome={view.name === "public"}
      error={providerError}
      autoRedirect={autoRedirect}
      onSignedIn={reload}
    />
  );
  switch (view.name) {
    case "loading":
      return <LoadingShell />;
    case "error":
      return <Unreachable onRetry={async () => (await refresh()).name === "error"} />;
    case "setup":
      return <Setup onDone={reload} onClosed={reload} providerError={providerError} />;
    case "public":
      if (path === SIGNED_OUT) return <SignedOut />;
      if (path === "/") {
        return (
          <AppShell user={null} path={path}>
            <Home user={null} />
          </AppShell>
        );
      }
      return signIn;
    case "signIn":
      return path === SIGNED_OUT ? <SignedOut /> : signIn;
    case "home": {
      const signOut = () => void signOutThen(refresh, Boolean(oidc));
      if (view.user.mustChangePassword) return <TemporaryPassword user={view.user} onDone={onPasswordSaved} onSignOut={signOut} />;
      return (
        <AppShell user={view.user} path={target} onSignOut={signOut}>
          <SignedInPage user={view.user} path={target} onProfileChanged={refresh} />
        </AppShell>
      );
    }
  }
}
