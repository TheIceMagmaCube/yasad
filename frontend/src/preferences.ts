// Per-browser preferences and the cached instance settings, kept in localStorage.
// public/theme-init.js applies the same rules before the first paint; keep both in step.

export const LANGUAGES = ["en", "fr"] as const;
export type Language = (typeof LANGUAGES)[number];

export const THEMES = ["default", "dusk", "night"] as const;
export type Theme = (typeof THEMES)[number];

export const MODES = ["system", "light", "dark"] as const;
export type Mode = (typeof MODES)[number];

type Key = "language" | "mode" | "devTheme" | "instanceTheme" | "instanceLanguage";

/** Return the stored value when it is one of `allowed`, otherwise null (also when storage is unavailable). */
export function readPreference<T extends string>(key: Key, allowed: readonly T[]): T | null {
  try {
    const value = localStorage.getItem(`yasad.${key}`);
    return allowed.find((a) => a === value) ?? null;
  } catch {
    return null;
  }
}

/** Store the value, or remove it when null; ignore unavailable storage. */
export function writePreference(key: Key, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(`yasad.${key}`);
    else localStorage.setItem(`yasad.${key}`, value);
  } catch {
    // Private mode or blocked storage: the preference lasts for this page only.
  }
}

/**
 * Return the interface language.
 *
 * Order: the person's choice, then the first browser language whose primary subtag is supported
 * (fr-CA gives fr), then the instance default.
 */
export function resolveLanguage(choice: Language | null, browser: readonly string[], instanceDefault: Language): Language {
  if (choice) return choice;
  for (const tag of browser) {
    const primary = LANGUAGES.find((l) => l === tag.split("-")[0]?.toLowerCase());
    if (primary) return primary;
  }
  return instanceDefault;
}

/** Return whether the dark palette applies for this mode. */
export function isDark(mode: Mode, systemDark: boolean): boolean {
  return mode === "dark" || (mode === "system" && systemDark);
}
