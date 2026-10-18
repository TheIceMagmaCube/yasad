import { useStrings } from "../i18n/LocaleProvider";
import { LanguageSelect } from "./preferences/LanguageSelect";
import { ModeToggle } from "./preferences/ModeToggle";

/** Render the language and appearance choices of the signed-out screens side by side: a small select and an icon toggle. */
export function PreferenceSelects() {
  const m = useStrings();
  return (
    <div role="group" aria-label={m.preferences.label} className="flex flex-wrap items-center gap-3">
      <LanguageSelect variant="compact" />
      <ModeToggle />
    </div>
  );
}
