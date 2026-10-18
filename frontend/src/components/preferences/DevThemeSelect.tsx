import { useId } from "react";

import { useStrings } from "../../i18n/LocaleProvider";
import { THEMES } from "../../preferences";
import { useTheme } from "../../theme/ThemeProvider";
import { NativeSelect } from "../ui/native-select";

/** Render the theme override of dev builds; render nothing in production. */
export function DevThemeSelect({ controlSize = "default" }: { controlSize?: "default" | "sm" }) {
  const m = useStrings();
  const { devTheme, setDevTheme } = useTheme();
  const id = useId();
  if (!import.meta.env.DEV) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-theme`} className={controlSize === "sm" ? "text-xs font-semibold" : "text-sm font-semibold"}>
        {m.preferences.theme}
      </label>
      <NativeSelect
        id={`${id}-theme`}
        controlSize={controlSize}
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
  );
}
