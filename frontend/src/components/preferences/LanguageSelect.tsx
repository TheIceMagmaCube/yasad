import { Globe } from "lucide-react";
import { Fragment, useId } from "react";

import { cn } from "@/lib/utils";

import { MESSAGES } from "../../i18n";
import { useLocale, useStrings } from "../../i18n/LocaleProvider";
import { LANGUAGES } from "../../preferences";
import { FormField } from "../form/FormField";
import { NativeSelect } from "../ui/native-select";

type LanguageSelectProps = {
  /** `compact`: a globe and a small select, labelled in every language; `field`: a labelled form field with a hint. */
  variant: "compact" | "field";
  className?: string;
};

/**
 * Render the interface language choice, applied at once and stored on this device. Each option is written in its
 * own language, so a person who cannot read the current one still finds theirs.
 */
export function LanguageSelect({ variant, className }: LanguageSelectProps) {
  const m = useStrings();
  const { language, setLanguage } = useLocale();
  const id = useId();
  const select = (props: { id: string; "aria-describedby"?: string }, size: "sm" | "default") => (
    <NativeSelect
      {...props}
      controlSize={size}
      value={language}
      onChange={(e) => setLanguage(LANGUAGES.find((l) => l === e.target.value) ?? language)}
    >
      {LANGUAGES.map((l) => (
        <option key={l} value={l} lang={l}>
          {m.languages[l]}
        </option>
      ))}
    </NativeSelect>
  );

  if (variant === "field") {
    return (
      <FormField id={`${id}-language`} label={m.preferences.language} hint={m.preferences.savedHere} className={className}>
        {(control) => select(control, "default")}
      </FormField>
    );
  }
  return (
    <div data-slot="language-select" className={cn("flex items-center gap-1.5", className)}>
      <Globe aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <label htmlFor={`${id}-language`} className="sr-only">
        {LANGUAGES.map((l, i) => (
          <Fragment key={l}>
            {i > 0 && " / "}
            <span lang={l}>{MESSAGES[l].preferences.language}</span>
          </Fragment>
        ))}
      </label>
      {select({ id: `${id}-language` }, "sm")}
    </div>
  );
}
