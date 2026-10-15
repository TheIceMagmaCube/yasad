import { createContext, useContext } from "react";

import { type Language, LANGUAGES, readPreference, type Theme, THEMES, writePreference } from "./preferences";

export type Instance = { title: string; logo: string | null; theme: Theme; defaultLanguage: Language; passwordSignIn: boolean };

/** Return the instance settings known before /api/instance answers: the cached theme and language, else the defaults. */
export function cachedInstance(): Instance {
  return {
    title: "YASAD",
    logo: null,
    theme: readPreference("instanceTheme", THEMES) ?? "default",
    defaultLanguage: readPreference("instanceLanguage", LANGUAGES) ?? "en",
    passwordSignIn: true,
  };
}

/** Remember the theme and language for the next first paint (see public/theme-init.js). */
export function cacheInstance(instance: Instance): void {
  writePreference("instanceTheme", instance.theme);
  writePreference("instanceLanguage", instance.defaultLanguage);
}

export const InstanceContext = createContext<Instance>({ title: "YASAD", logo: null, theme: "default", defaultLanguage: "en", passwordSignIn: true });

/** Return the instance settings (title, logo, theme, default language). */
export function useInstance(): Instance {
  return useContext(InstanceContext);
}
