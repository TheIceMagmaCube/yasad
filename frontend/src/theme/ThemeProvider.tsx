import { createContext, type ReactNode, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { isDark, type Mode, MODES, readPreference, type Theme, THEMES, writePreference } from "../preferences";

type ThemeState = {
  mode: Mode;
  setMode: (mode: Mode) => void;
  /** Theme override, only honoured in dev builds; null follows the instance theme. */
  devTheme: Theme | null;
  setDevTheme: (theme: Theme | null) => void;
};

const ThemeContext = createContext<ThemeState | null>(null);
const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeToSystem(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const systemIsDark = () => window.matchMedia(DARK_QUERY).matches;

/** Apply the instance theme (or the dev override) and the light or dark mode to the document. */
export function ThemeProvider({ instanceTheme, children }: { instanceTheme: Theme; children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>(() => readPreference("mode", MODES) ?? "system");
  const [devTheme, setDevThemeState] = useState(() => (import.meta.env.DEV ? readPreference("devTheme", THEMES) : null));
  const systemDark = useSyncExternalStore(subscribeToSystem, systemIsDark);
  const theme = devTheme ?? instanceTheme;
  const dark = isDark(mode, systemDark);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.mode = dark ? "dark" : "light";
  }, [theme, dark]);

  const value = useMemo<ThemeState>(
    () => ({
      mode,
      setMode: (next) => {
        writePreference("mode", next);
        setModeState(next);
      },
      devTheme,
      setDevTheme: (next) => {
        writePreference("devTheme", next);
        setDevThemeState(next);
      },
    }),
    [mode, devTheme],
  );
  return <ThemeContext value={value}>{children}</ThemeContext>;
}

/** Return the appearance settings and their setters. */
export function useTheme(): ThemeState {
  const state = useContext(ThemeContext);
  if (!state) throw new Error("useTheme needs a ThemeProvider");
  return state;
}
