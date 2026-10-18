import { Monitor, Moon, Sun } from "lucide-react";
import { useId } from "react";

import { cn } from "@/lib/utils";

import { useStrings } from "../../i18n/LocaleProvider";
import { MODES } from "../../preferences";
import { useTheme } from "../../theme/ThemeProvider";

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

/**
 * Classes of the visible face of each option. The chosen one is raised on the card colour with the `selected` ring,
 * since the card alone is too close to the track to mark it; the track is the page colour, a ground the theme
 * contrast test checks `selected` against. Rings are shadows, which forced colors drop, so that mode paints the
 * chosen option with the system highlight instead. The face opts out of forced colors to keep that highlight, so
 * its focus outline needs a system colour too, or it keeps the theme ring on the system canvas.
 */
const FACE = cn(
  "flex size-10 items-center justify-center rounded-[calc(var(--radius)-2px)] text-muted-foreground hover:text-foreground",
  "peer-checked:bg-card peer-checked:text-foreground peer-checked:shadow-[0_0_0_2px_var(--selected),0_2px_0_var(--panel-depth)]",
  "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring forced-colors:peer-focus-visible:outline-[color:CanvasText]",
  "forced-colors:forced-color-adjust-none forced-colors:text-[color:ButtonText] forced-colors:peer-checked:bg-[color:Highlight] forced-colors:peer-checked:text-[color:HighlightText]",
);

/**
 * Render the light, dark or system choice as a compact row of icon radio buttons, applied at once. Native radios
 * keep the arrow keys; each option is named by its text, hidden visually behind the icon.
 */
export function ModeToggle() {
  const m = useStrings();
  const { mode, setMode } = useTheme();
  const id = useId();
  return (
    <fieldset data-slot="mode-toggle" className="inline-flex rounded-md bg-background p-0.5 ring-[1.5px] ring-control-ring">
      <legend className="sr-only">{m.preferences.appearance}</legend>
      {MODES.map((x) => {
        const Icon = ICONS[x];
        return (
          <label key={x} className="relative cursor-pointer">
            <input type="radio" name={`${id}-mode`} value={x} checked={mode === x} onChange={() => setMode(x)} className="peer sr-only" />
            <span aria-hidden="true" className={FACE}>
              <Icon className="size-4" />
            </span>
            <span className="sr-only">{m.preferences.modes[x]}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
