import { useCallback, useEffect, useRef, useState } from "react";

import { api, ApiError, onStaleSession, type SetupState, type User } from "./api";
import { AppShell } from "./components/AppShell";
import { LoadingShell } from "./components/LoadingShell";
import { type Notice, ShellNoticeProvider } from "./components/ShellNotice";
import { LocaleProvider } from "./i18n/LocaleProvider";
import { cachedInstance, cacheInstance, type Instance, InstanceContext, useInstance } from "./instance";
import { invalidateHome, onViewerChanged, primeHome } from "./lib/home-store";
import { AnnouncerProvider } from "./lib/announcer";
import { useFocusOnNavigation, useFocusOnViewChange } from "./lib/focus";
import { navigate, normalizePath, useNavigations, usePath } from "./lib/router";
import { AdminCatalog } from "./pages/AdminCatalog";
import { AdminGroups } from "./pages/admin/AdminGroups";
import { adminTab, AdminLayout } from "./pages/admin/AdminLayout";
import { AdminUsers } from "./pages/admin/AdminUsers";
import { ChangePassword } from "./pages/ChangePassword";
import { Forbidden, NotFound } from "./pages/ErrorViews";
import { Home } from "./pages/Home";
import { Setup } from "./pages/Setup";
import { SignIn } from "./pages/SignIn";
import { Unreachable } from "./pages/Unreachable";
import { ThemeProvider } from "./theme/ThemeProvider";

/** Path showing the password form even when password sign-in is off (local admins only). */
const LOCAL_SIGN_IN = "/sign-in/local";
/** Path of the sign-in screen when "/" shows the public links. */
const SIGN_IN = "/sign-in";

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

  const viewRef = useRef(view);
  const pending = useRef(0);
  const navigations = useNavigations();
  const navigationsRef = useRef(navigations);
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

  const shownNotice = notice && notice.navigations === navigations ? notice : null;
  const expired = expiredAt === navigations;
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
              <Screen view={view} refresh={refresh} expired={expired} />
            </ShellNoticeProvider>
          </AnnouncerProvider>
        </ThemeProvider>
      </LocaleProvider>
    </InstanceContext>
  );
}

/** Return the canonical form of a path: no trailing slash, and the administration section opened on its first tab. */
function canonicalPath(path: string): string {
  const normalized = normalizePath(path);
  return normalized === "/admin" ? "/admin/users" : normalized;
}

/** Return the page of a signed-in user for a canonical path. */
function SignedInPage({ user, path }: { user: User; path: string }) {
  if (path === "/") return <Home user={user} />;
  if (path === "/admin" || path.startsWith("/admin/")) {
    if (user.role !== "admin") return <Forbidden />;
    const tab = adminTab(path);
    if (!tab) return <NotFound />;
    return (
      <AdminLayout tab={tab}>
        {tab === "users" ? <AdminUsers me={user} /> : tab === "groups" ? <AdminGroups /> : <AdminCatalog />}
      </AdminLayout>
    );
  }
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

function Screen({ view, refresh, expired }: { view: View; refresh: () => Promise<View>; expired: boolean }) {
  const { passwordSignIn } = useInstance();
  const rawPath = usePath();
  const path = canonicalPath(rawPath);
  const signedIn = view.name === "home";
  // A signed-in person has nothing to do on the sign-in paths. /sign-in/local only matters with password sign-in
  // off, known once the first view is loaded (the instance settings come with it).
  const signedOut = view.name === "signIn" || view.name === "public";
  const target =
    signedIn && (path === LOCAL_SIGN_IN || path === SIGN_IN) ? "/" : signedOut && path === LOCAL_SIGN_IN && passwordSignIn ? SIGN_IN : path;

  useEffect(() => {
    if (target !== rawPath) navigate(target + location.search + location.hash, { replace: true });
  }, [target, rawPath]);

  useFocusOnNavigation();
  useFocusOnViewChange(viewKeyOf(view));

  const reload = () => void refresh();
  const signIn = (
    <SignIn local={path === LOCAL_SIGN_IN} expired={expired} publicHome={view.name === "public"} onSignedIn={reload} />
  );
  switch (view.name) {
    case "loading":
      return <LoadingShell />;
    case "error":
      return <Unreachable onRetry={async () => (await refresh()).name === "error"} />;
    case "setup":
      return <Setup onDone={reload} onClosed={reload} />;
    case "public":
      if (path === "/") {
        return (
          <AppShell user={null} path={path}>
            <Home user={null} />
          </AppShell>
        );
      }
      return signIn;
    case "signIn":
      return signIn;
    case "home":
      return (
        <AppShell user={view.user} path={target} minimal={view.user.mustChangePassword} onSignOut={() => void api.signOut().finally(reload)}>
          {view.user.mustChangePassword ? <ChangePassword onChanged={reload} /> : <SignedInPage user={view.user} path={target} />}
        </AppShell>
      );
  }
}
