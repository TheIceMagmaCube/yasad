import { useId } from "react";

import { useLocale, useStrings } from "../i18n/LocaleProvider";
import { LANGUAGES, MODES, THEMES } from "../preferences";
import { useTheme } from "../theme/ThemeProvider";
import { NativeSelect } from "./ui/native-select";

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
        <NativeSelect
          id={`${id}-language`}
          controlSize="sm" className="mt-1"
          value={language}
          onChange={(e) => setLanguage(LANGUAGES.find((l) => l === e.target.value) ?? language)}
        >
          {LANGUAGES.map((l) => (
            <option key={l} value={l} lang={l}>
              {m.languages[l]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div>
        <label htmlFor={`${id}-mode`} className="text-xs font-semibold">
          {m.preferences.appearance}
        </label>
        <NativeSelect id={`${id}-mode`} controlSize="sm" className="mt-1" value={mode} onChange={(e) => setMode(MODES.find((x) => x === e.target.value) ?? mode)}>
          {MODES.map((x) => (
            <option key={x} value={x}>
              {m.preferences.modes[x]}
            </option>
          ))}
        </NativeSelect>
      </div>
      {import.meta.env.DEV && (
        <div>
          <label htmlFor={`${id}-theme`} className="text-xs font-semibold">
            {m.preferences.theme}
          </label>
          <NativeSelect
            id={`${id}-theme`}
            controlSize="sm" className="mt-1"
            value={devTheme ?? ""}
            onChange={(e) => setDevTheme(THEMES.find((t) => t === e.target.value) ?? null)}
          >
            <option value="">-</option>
            {THEMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
    </div>
  );
}
