import { Check } from "lucide-react";
import { type ComponentProps, type ReactNode, useId } from "react";

import { cn } from "@/lib/utils";

type CheckboxProps = Omit<ComponentProps<"input">, "type">;

/**
 * Render a native checkbox drawn with tokens: a muted-foreground border (3:1 against the background), filled
 * with the primary color and a check mark when checked. Forced colors mode gets the system control back.
 */
function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <span data-slot="checkbox" className="relative inline-flex size-5 shrink-0">
      <input
        type="checkbox"
        className={cn(
          "peer size-5 shrink-0 cursor-pointer appearance-none rounded-sm border-2 border-muted-foreground bg-card outline-none checked:border-foreground checked:bg-primary checked:shadow-[inset_0_-2px_0_var(--primary-shade)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive forced-colors:appearance-auto",
          className,
        )}
        {...props}
      />
      <Check
        aria-hidden="true"
        strokeWidth={3}
        className="pointer-events-none absolute inset-0.5 hidden size-4 text-primary-foreground peer-checked:block forced-colors:hidden"
      />
    </span>
  );
}

type CheckboxFieldProps = CheckboxProps & { label: ReactNode; hint?: ReactNode };

/** Render a checkbox whose whole row, label and hint included, is its click target (at least 44 px high). */
function CheckboxField({ label, hint, id: givenId, ...props }: CheckboxFieldProps) {
  const generated = useId();
  const id = givenId ?? generated;
  return (
    <label htmlFor={id} data-slot="checkbox-field" className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5">
      <Checkbox id={id} aria-labelledby={`${id}-label`} aria-describedby={hint ? `${id}-hint` : undefined} {...props} />
      <span className="min-w-0">
        <span id={`${id}-label`} className="block font-heading text-sm leading-5 font-bold">
          {label}
        </span>
        {hint && (
          <span id={`${id}-hint`} className="mt-0.5 block text-sm text-muted-foreground">
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}

export { Checkbox, CheckboxField };
