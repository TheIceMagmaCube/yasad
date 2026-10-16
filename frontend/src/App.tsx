import { useCallback, useEffect, useRef, useState } from "react";

import { api, ApiError, onStaleSession, type SetupState, type User } from "./api";
import { AppShell } from "./components/AppShell";
import { LocaleProvider, useStrings } from "./i18n/LocaleProvider";
import { cachedInstance, cacheInstance, type Instance, InstanceContext } from "./instance";
import { invalidateHome, onViewerChanged, primeHome } from "./lib/home-store";
import { useDocumentTitle, useFocusOnNavigation } from "./lib/page";
import { navigate, normalizePath, usePath } from "./lib/router";
import { AdminCatalog } from "./pages/AdminCatalog";
import { AdminGroups } from "./pages/admin/AdminGroups";
import { adminTab, AdminLayout } from "./pages/admin/AdminLayout";
import { AdminUsers } from "./pages/admin/AdminUsers";
import { ChangePassword } from "./pages/ChangePassword";
import { Forbidden, NotFound } from "./pages/ErrorViews";
import { Home } from "./pages/Home";
import { Setup } from "./pages/Setup";
import { SignIn } from "./pages/SignIn";
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

export function App() {
  const [instance, setInstance] = useState(cachedInstance);
  const [view, setView] = useState<View>({ name: "loading" });

  const viewRef = useRef(view);
  const pending = useRef(0);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // Every session change goes through here (expired session, sign-in, sign-out, password changed, setup done):
  // the cached home data of the previous viewer is dropped before anything else is shown.
  const refresh = useCallback(() => {
    invalidateHome();
    pending.current += 1;
    void loadView()
      .then(setView)
      .finally(() => {
        pending.current -= 1;
      });
  }, []);

  // Client-side navigation keeps the session loaded at start: reload it when the API says it changed
  // (signed out, password reset by an admin, admin rights removed), so the right screen replaces the stale one.
  useEffect(
    () =>
      onStaleSession((code) => {
        const current = viewRef.current;
        if (current.name !== "home" || pending.current > 0) return;
        if (code === "password_change_required" && current.user.mustChangePassword) return;
        refresh();
      }),
    [refresh],
  );

  // The home store got an answer for another viewer (signed in or out in another tab, session expired): it
  // dropped it, and the session is reloaded so the screen matches the cookie, whatever the current view.
  useEffect(
    () =>
      onViewerChanged(() => {
        if (pending.current === 0) refresh();
      }),
    [refresh],
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

  return (
    <InstanceContext value={instance}>
      <LocaleProvider defaultLanguage={instance.defaultLanguage}>
        <ThemeProvider instanceTheme={instance.theme}>
          <Screen view={view} refresh={refresh} />
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

/** Say "loading" or "unreachable" under the instance title. */
function Status({ role, text }: { role: "status" | "alert"; text: string }) {
  useDocumentTitle();
  return (
    <p role={role} className="p-8">
      {text}
    </p>
  );
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

function Screen({ view, refresh }: { view: View; refresh: () => void }) {
  const m = useStrings();
  const rawPath = usePath();
  const path = canonicalPath(rawPath);
  const signedIn = view.name === "home";
  const target = signedIn && (path === LOCAL_SIGN_IN || path === SIGN_IN) ? "/" : path;

  useEffect(() => {
    if (target !== rawPath) navigate(target + location.search + location.hash, { replace: true });
  }, [target, rawPath]);

  useFocusOnNavigation();

  switch (view.name) {
    case "loading":
      return <Status role="status" text={m.loading} />;
    case "error":
      return <Status role="alert" text={m.errors.unreachable} />;
    case "setup":
      return <Setup onDone={refresh} onClosed={refresh} />;
    case "public":
      if (path === "/") {
        return (
          <AppShell user={null} path={path}>
            <Home user={null} />
          </AppShell>
        );
      }
      return <SignIn local={path === LOCAL_SIGN_IN} onSignedIn={refresh} />;
    case "signIn":
      return <SignIn local={path === LOCAL_SIGN_IN} onSignedIn={refresh} />;
    case "home":
      return (
        <AppShell user={view.user} path={target} nav={!view.user.mustChangePassword} onSignOut={() => void api.signOut().finally(refresh)}>
          {view.user.mustChangePassword ? <ChangePassword onChanged={refresh} /> : <SignedInPage user={view.user} path={target} />}
        </AppShell>
      );
  }
}
