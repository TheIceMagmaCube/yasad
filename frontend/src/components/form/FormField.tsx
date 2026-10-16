import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { useStrings } from "../../i18n/LocaleProvider";

/** Attributes a form field gives its control. */
export type ControlProps = { id: string; "aria-invalid"?: true; "aria-describedby"?: string };

/** Props shared by every field: the error state comes from `useFormErrors().field(name)`. */
export type FieldState = {
  id: string;
  /** Message shown under the control. */
  error?: string;
  /** Mark the control invalid without a message of its own (the summary title describes it). */
  invalid?: boolean;
  /** Id of the error summary title, used to describe a control marked invalid without a message. */
  describedBy?: string;
};

type FormFieldProps = FieldState & {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
  /** Render the control with the given attributes. */
  children: (control: ControlProps) => ReactNode;
};

/** Return the aria-describedby of a control: hint, error, then the summary title when invalid without a message. */
export function describedByOf({ id, error, invalid, describedBy, hint }: FieldState & { hint?: unknown }): string | undefined {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null, !error && invalid ? describedBy : null];
  return ids.filter(Boolean).join(" ") || undefined;
}

/** Render a field error: an icon, a hidden "Error:" prefix, then the message. */
export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  const m = useStrings();
  return (
    <p id={id} className="flex gap-1.5 text-sm text-destructive">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>
        <span className="sr-only">{m.forms.errorPrefix}</span> {children}
      </span>
    </p>
  );
}

/**
 * Render a labelled control: label, hint, control, error, in that order and without outer margin.
 *
 * The control is marked aria-invalid as soon as there is an error or `invalid`, and described by the hint, the
 * error, then the summary title when it is invalid without a message of its own.
 */
export function FormField({ id, label, hint, error, invalid, describedBy, className, children }: FormFieldProps) {
  return (
    <div data-slot="form-field" className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {children({ id, "aria-invalid": error || invalid ? true : undefined, "aria-describedby": describedByOf({ id, error, invalid, describedBy, hint }) })}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}
