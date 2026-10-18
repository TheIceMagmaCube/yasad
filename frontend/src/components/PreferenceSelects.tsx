import { useId } from "react";

import { useLocale, useStrings } from "../i18n/LocaleProvider";
import { LANGUAGES, MODES } from "../preferences";
import { useTheme } from "../theme/ThemeProvider";
import { DevThemeSelect } from "./preferences/DevThemeSelect";
import { NativeSelect } from "./ui/native-select";

/**
 * Language and appearance selectors for the footers of the signed-out screens (native selects: no injected
 * styles). `language={false}` leaves the language out, when the screen offers it elsewhere.
 */
export function PreferenceSelects({ language: withLanguage = true }: { language?: boolean }) {
  const m = useStrings();
  const { language, setLanguage } = useLocale();
  const { mode, setMode } = useTheme();
  const id = useId();
  return (
    <div className="flex flex-wrap gap-4">
      {withLanguage && (
        <div>
          <label htmlFor={`${id}-language`} className="text-xs font-semibold">
            {m.preferences.language}
          </label>
          <NativeSelect
            id={`${id}-language`}
            controlSize="sm"
            className="mt-1"
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
      )}
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
      <DevThemeSelect controlSize="sm" />
    </div>
  );
}
