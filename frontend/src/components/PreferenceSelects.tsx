import { cn } from "@/lib/utils";

import { useStrings } from "../i18n/LocaleProvider";
import { LanguageSelect } from "./preferences/LanguageSelect";
import { ModeToggle } from "./preferences/ModeToggle";

/** Language and appearance choices of the signed-out screens, side by side: a small select and an icon toggle. */
export function PreferenceSelects({ className }: { className?: string }) {
  const m = useStrings();
  return (
    <div role="group" aria-label={m.preferences.label} className={cn("flex flex-wrap items-center gap-3", className)}>
      <LanguageSelect variant="compact" />
      <ModeToggle />
    </div>
  );
}
