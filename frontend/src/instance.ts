import { createContext, useContext } from "react";

import { type Language, LANGUAGES, readPreference, type Theme, THEMES, writePreference } from "./preferences";

/** The identity provider, when OIDC is configured: `name` labels its sign-in button. */
export type OidcProvider = { name: string };

export type Instance = {
  title: string;
  logo: string | null;
  theme: Theme;
  defaultLanguage: Language;
  passwordSignIn: boolean;
  oidc: OidcProvider | null;
};

/** Return the instance settings known before /api/instance answers: the cached theme and language, else the defaults. */
export function cachedInstance(): Instance {
  return {
    title: "YASAD",
    logo: null,
    theme: readPreference("instanceTheme", THEMES) ?? "default",
    defaultLanguage: readPreference("instanceLanguage", LANGUAGES) ?? "en",
    passwordSignIn: true,
    oidc: null,
  };
}

/** Remember the theme and language for the next first paint (see public/theme-init.js). */
export function cacheInstance(instance: Instance): void {
  writePreference("instanceTheme", instance.theme);
  writePreference("instanceLanguage", instance.defaultLanguage);
}

export const InstanceContext = createContext<Instance>({ title: "YASAD", logo: null, theme: "default", defaultLanguage: "en", passwordSignIn: true, oidc: null });

/** Return the instance settings (title, logo, theme, default language). */
export function useInstance(): Instance {
  return useContext(InstanceContext);
}

/** Read the instance settings again and apply them everywhere: header, sign-in screens, theme, document title. */
export const ReloadInstanceContext = createContext<() => Promise<void>>(async () => {});

/** Return the function reading the instance settings again, after an admin changed them. */
export function useReloadInstance(): () => Promise<void> {
  return useContext(ReloadInstanceContext);
}

/**
 * Point the tab icon at the instance's icon again, under a new address so the browser asks for it: `version`
 * changes with the logo. The icon is read through /api/instance/icon, which follows the setting.
 */
export function refreshTabIcon(version: string): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link) link.href = `/api/instance/icon?v=${encodeURIComponent(version)}`;
}
