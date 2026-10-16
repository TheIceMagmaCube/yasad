import { useCallback, useEffect, useState } from "react";

import { api, ApiError, type SetupState, type User } from "./api";
import { AppShell } from "./components/AppShell";
import { LocaleProvider, useStrings } from "./i18n/LocaleProvider";
import { cachedInstance, cacheInstance, type Instance, InstanceContext } from "./instance";
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

type View = { name: "loading" } | { name: "error" } | { name: "setup" } | { name: "signIn" } | { name: "home"; user: User };

/** Treat the setup state as closed when the API waits for a temporary password to be replaced. */
function passwordChangePending(err: unknown): SetupState {
  if (err instanceof ApiError && err.body.code === "password_change_required") return { open: false };
  throw err;
}

/** Return the screen to show: setup while open and nobody is signed in, then home or sign-in. */
async function loadView(): Promise<View> {
  try {
    const [setup, user] = await Promise.all([api.setupState().catch(passwordChangePending), api.session()]);
    if (setup.open && !user) return { name: "setup" };
    return user ? { name: "home", user } : { name: "signIn" };
  } catch {
    return { name: "error" };
  }
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

  const refresh = useCallback(() => void loadView().then(setView), []);

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
  const target = signedIn && path === LOCAL_SIGN_IN ? "/" : path;

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
    case "signIn":
      return (
        <SignIn
          local={path === LOCAL_SIGN_IN}
          onSignedIn={() => {
            if (location.pathname === LOCAL_SIGN_IN) navigate("/", { replace: true });
            refresh();
          }}
        />
      );
    case "home":
      return (
        <AppShell user={view.user} path={target} nav={!view.user.mustChangePassword} onSignOut={() => void api.signOut().finally(refresh)}>
          {view.user.mustChangePassword ? <ChangePassword onChanged={refresh} /> : <SignedInPage user={view.user} path={target} />}
        </AppShell>
      );
  }
}
