import { useId } from "react";

import { useStrings } from "../../i18n/LocaleProvider";
import { MODES } from "../../preferences";
import { useTheme } from "../../theme/ThemeProvider";

/** Render the light, dark or system choice as native radio buttons in a fieldset, applied at once. */
export function AppearanceRadios({ legend }: { legend: string }) {
  const m = useStrings();
  const { mode, setMode } = useTheme();
  const id = useId();
  return (
    <fieldset aria-describedby={`${id}-hint`}>
      <legend className="text-sm font-semibold">{legend}</legend>
      <p id={`${id}-hint`} className="mt-1 text-sm text-muted-foreground">
        {m.preferences.savedHere}
      </p>
      <div className="mt-2 flex flex-wrap gap-x-6">
        {MODES.map((x) => (
          <label key={x} className="flex min-h-11 cursor-pointer items-center gap-2">
            <input
              type="radio"
              name={`${id}-mode`}
              value={x}
              checked={mode === x}
              onChange={() => setMode(x)}
              className="size-4 shrink-0 cursor-pointer accent-primary outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
            {m.preferences.modes[x]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
