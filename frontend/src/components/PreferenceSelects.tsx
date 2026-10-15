import { useId } from "react";

import { useLocale, useStrings } from "../i18n/LocaleProvider";
import { LANGUAGES, MODES, THEMES } from "../preferences";
import { useTheme } from "../theme/ThemeProvider";

const selectClass =
  "mt-1 block w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Language and appearance selectors for the signed-out screens (native selects: no injected styles). */
export function PreferenceSelects() {
  const m = useStrings();
  const { language, setLanguage } = useLocale();
  const { mode, setMode, devTheme, setDevTheme } = useTheme();
  const id = useId();
  return (
    <div className="flex flex-wrap gap-4">
      <div>
        <label htmlFor={`${id}-language`} className="text-xs font-semibold">
          {m.preferences.language}
        </label>
        <select
          id={`${id}-language`}
          className={selectClass}
          value={language}
          onChange={(e) => setLanguage(LANGUAGES.find((l) => l === e.target.value) ?? language)}
        >
          {LANGUAGES.map((l) => (
            <option key={l} value={l} lang={l}>
              {m.languages[l]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-mode`} className="text-xs font-semibold">
          {m.preferences.appearance}
        </label>
        <select id={`${id}-mode`} className={selectClass} value={mode} onChange={(e) => setMode(MODES.find((x) => x === e.target.value) ?? mode)}>
          {MODES.map((x) => (
            <option key={x} value={x}>
              {m.preferences.modes[x]}
            </option>
          ))}
        </select>
      </div>
      {import.meta.env.DEV && (
        <div>
          <label htmlFor={`${id}-theme`} className="text-xs font-semibold">
            {m.preferences.theme}
          </label>
          <select
            id={`${id}-theme`}
            className={selectClass}
            value={devTheme ?? ""}
            onChange={(e) => setDevTheme(THEMES.find((t) => t === e.target.value) ?? null)}
          >
            <option value="">-</option>
            {THEMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
