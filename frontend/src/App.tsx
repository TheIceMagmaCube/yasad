import { useCallback, useEffect, useState } from "react";

import { api, type User } from "./api";
import { Home } from "./pages/Home";
import { Setup } from "./pages/Setup";
import { SignIn } from "./pages/SignIn";
import { strings } from "./strings";

type View = { name: "loading" } | { name: "error" } | { name: "setup" } | { name: "signIn" } | { name: "home"; user: User };

export function App() {
  const [view, setView] = useState<View>({ name: "loading" });

  const refresh = useCallback(async () => {
    try {
      const [setup, user] = await Promise.all([api.setupState(), api.session()]);
      if (setup.open && !user) setView({ name: "setup" });
      else if (user) setView({ name: "home", user });
      else setView({ name: "signIn" });
    } catch {
      setView({ name: "error" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  switch (view.name) {
    case "loading":
      return <p role="status" className="p-8">{strings.loading}</p>;
    case "error":
      return <p role="alert" className="p-8">{strings.errors.unreachable}</p>;
    case "setup":
      return <Setup onDone={refresh} onClosed={refresh} />;
    case "signIn":
      return <SignIn onSignedIn={refresh} />;
    case "home":
      return <Home user={view.user} onSignOut={() => void api.signOut().finally(refresh)} />;
  }
}
