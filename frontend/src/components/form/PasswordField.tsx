import { Eye, EyeOff } from "lucide-react";
import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from "react";

import { useStrings } from "../../i18n/LocaleProvider";
import { type FieldState, FormField } from "./FormField";

type PasswordFieldProps = FieldState &
  Omit<ComponentProps<"input">, "id" | "type"> & {
    label: ReactNode;
    hint?: ReactNode;
  };

/**
 * Render a labelled password input with a "Show" toggle beside it, never over the text.
 *
 * The toggle is a native button with aria-pressed and a fixed name that contains its visible word. The password
 * goes back to hidden when its form is submitted and when the value is emptied.
 */
export function PasswordField({ id, label, hint, error, invalid, describedBy, className, value, ...input }: PasswordFieldProps) {
  const m = useStrings();
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  // Hide again once the value is emptied (cleared after a failed sign-in, or by the person).
  const empty = value === "" || value === undefined;
  const [wasEmpty, setWasEmpty] = useState(empty);
  if (empty !== wasEmpty) {
    setWasEmpty(empty);
    if (empty) setShown(false);
  }

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const hide = () => setShown(false);
    form.addEventListener("submit", hide);
    return () => form.removeEventListener("submit", hide);
  }, []);

  const Icon = shown ? EyeOff : Eye;
  return (
    <FormField id={id} label={label} hint={hint} error={error} invalid={invalid} describedBy={describedBy} className={className}>
      {(control) => (
        <div className="sunken flex h-10 w-full min-w-0 rounded-md border-[1.5px] border-input bg-card has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring has-[input:focus-visible]:ring-offset-2 has-[input:focus-visible]:ring-offset-background has-[input:focus-visible]:outline-hidden has-[[aria-invalid=true]]:border-destructive">
          <input
            ref={ref}
            {...input}
            {...control}
            value={value}
            type={shown ? "text" : "password"}
            spellCheck={false}
            autoCapitalize="none"
            className="min-w-0 flex-1 rounded-l-md bg-transparent px-3 py-2 text-base text-foreground outline-none placeholder:text-muted-foreground md:text-sm [&::-ms-reveal]:hidden"
          />
          <button
            type="button"
            aria-pressed={shown}
            aria-controls={id}
            aria-label={m.forms.showPassword}
            onClick={() => setShown((x) => !x)}
            className="flex shrink-0 items-center gap-1.5 rounded-r-md border-l-[1.5px] border-input px-3 font-heading text-sm font-bold text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-hidden focus-visible:-outline-offset-4"
          >
            <Icon aria-hidden="true" className="size-4" />
            {m.forms.show}
          </button>
        </div>
      )}
    </FormField>
  );
}
