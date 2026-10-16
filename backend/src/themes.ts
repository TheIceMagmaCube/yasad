/** Ids of the preset themes; each has a CSS file in frontend/src/theme/themes/. */
export const THEMES = ["default", "dusk", "night"] as const;
export type Theme = (typeof THEMES)[number];

/** Return the theme id when it is a preset, otherwise the default theme. */
export function knownTheme(value: string | undefined): Theme {
  return THEMES.find((t) => t === value) ?? "default";
}
