import { useCallback, useEffect, useState } from "react";

import { api, type User } from "./api";
import { AppShell } from "./components/AppShell";
import { LocaleProvider, useStrings } from "./i18n/LocaleProvider";
import { cachedInstance, cacheInstance, type Instance, InstanceContext } from "./instance";
import { Home } from "./pages/Home";
import { Setup } from "./pages/Setup";
import { SignIn } from "./pages/SignIn";
import { ThemeProvider } from "./theme/ThemeProvider";

type View = { name: "loading" } | { name: "error" } | { name: "setup" } | { name: "signIn" } | { name: "home"; user: User };

/** Return the screen to show: setup while open and nobody is signed in, then home or sign-in. */
async function loadView(): Promise<View> {
  try {
    const [setup, user] = await Promise.all([api.setupState(), api.session()]);
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

  useEffect(() => {
    document.title = instance.title;
  }, [instance.title]);

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

function Screen({ view, refresh }: { view: View; refresh: () => void }) {
  const m = useStrings();
  switch (view.name) {
    case "loading":
      return (
        <p role="status" className="p-8">
          {m.loading}
        </p>
      );
    case "error":
      return (
        <p role="alert" className="p-8">
          {m.errors.unreachable}
        </p>
      );
    case "setup":
      return <Setup onDone={refresh} onClosed={refresh} />;
    case "signIn":
      return <SignIn onSignedIn={refresh} />;
    case "home":
      return (
        <AppShell user={view.user} onSignOut={() => void api.signOut().finally(refresh)}>
          <Home user={view.user} />
        </AppShell>
      );
  }
}
