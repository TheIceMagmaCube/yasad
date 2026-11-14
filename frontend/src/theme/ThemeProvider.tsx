import { createContext, type ReactNode, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { isDark, type Mode, MODES, readPreference, type Theme, writePreference } from "../preferences";

type ThemeState = {
  mode: Mode;
  setMode: (mode: Mode) => void;
};

const ThemeContext = createContext<ThemeState | null>(null);
const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeToSystem(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const systemIsDark = () => window.matchMedia(DARK_QUERY).matches;

/**
 * Return a CSS colour as `#rrggbb`, or null when it cannot be read. Some themes are written in oklch, which
 * `getComputedStyle` gives back as is and `theme-color` is not understood everywhere: painting it on a 1 px
 * canvas gives its sRGB value.
 *
 * The canvas ignores a colour it cannot parse and keeps the previous one: assigned over two different colours, an
 * unreadable value leaves two different fill styles, where a readable one leaves the same.
 */
export function hexColor(color: string): string | null {
  if (!color) return null;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return null;
  context.fillStyle = "#000000";
  context.fillStyle = color;
  const first = context.fillStyle;
  context.fillStyle = "#ffffff";
  context.fillStyle = color;
  if (context.fillStyle !== first) return null;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Set the colour the browser gives its own interface around the page: the header's, so both read as one bar. */
function setThemeColor(color: string): void {
  const hex = hexColor(color);
  if (!hex) return;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
  }
  meta.content = hex;
}

/** Apply the instance theme and the light or dark mode to the document, and the matching browser colour. */
export function ThemeProvider({ instanceTheme, children }: { instanceTheme: Theme; children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>(() => readPreference("mode", MODES) ?? "system");
  const systemDark = useSyncExternalStore(subscribeToSystem, systemIsDark);
  const dark = isDark(mode, systemDark);

  useEffect(() => {
    document.documentElement.dataset.theme = instanceTheme;
    document.documentElement.dataset.mode = dark ? "dark" : "light";
    setThemeColor(getComputedStyle(document.documentElement).getPropertyValue("--header").trim());
  }, [instanceTheme, dark]);

  const value = useMemo<ThemeState>(
    () => ({
      mode,
      setMode: (next) => {
        writePreference("mode", next);
        setModeState(next);
      },
    }),
    [mode],
  );
  return <ThemeContext value={value}>{children}</ThemeContext>;
}

/** Return the appearance settings and their setters. */
export function useTheme(): ThemeState {
  const state = useContext(ThemeContext);
  if (!state) throw new Error("useTheme needs a ThemeProvider");
  return state;
}
