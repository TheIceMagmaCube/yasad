import { Monitor, Moon, Sun } from "lucide-react";
import { useId } from "react";

import { cn } from "@/lib/utils";

import { useStrings } from "../../i18n/LocaleProvider";
import { MODES } from "../../preferences";
import { useTheme } from "../../theme/ThemeProvider";

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

/**
 * Render the light, dark or system choice as a compact row of icon radio buttons, applied at once. Native radios
 * keep the arrow keys; each option is named by its text, hidden visually behind the icon.
 */
export function ModeToggle({ className }: { className?: string }) {
  const m = useStrings();
  const { mode, setMode } = useTheme();
  const id = useId();
  return (
    <fieldset data-slot="mode-toggle" className={cn("inline-flex rounded-md bg-muted p-0.5 ring-[1.5px] ring-border", className)}>
      <legend className="sr-only">{m.preferences.appearance}</legend>
      {MODES.map((x) => {
        const Icon = ICONS[x];
        return (
          <label key={x} className="relative cursor-pointer">
            <input type="radio" name={`${id}-mode`} value={x} checked={mode === x} onChange={() => setMode(x)} className="peer sr-only" />
            <span
              aria-hidden="true"
              className="flex size-10 items-center justify-center rounded-[calc(var(--radius)-2px)] text-muted-foreground peer-checked:bg-card peer-checked:text-foreground peer-checked:shadow-[0_0_0_1.5px_var(--border),0_2px_0_var(--panel-depth)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-ring hover:text-foreground"
            >
              <Icon className="size-4" />
            </span>
            <span className="sr-only">{m.preferences.modes[x]}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
