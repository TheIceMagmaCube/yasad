import type { ComponentProps, ReactNode } from "react";

import { Input } from "@/components/ui/input";

import { type FieldState, FormField } from "./FormField";

type FieldProps = FieldState &
  Omit<ComponentProps<"input">, "id"> & {
    label: ReactNode;
    hint?: ReactNode;
    /** Classes of the input itself; `className` applies to the whole field. */
    inputClassName?: string;
  };

/** Render a labelled text input; see {@link FormField}. */
export function Field({ id, label, hint, error, invalid, describedBy, className, inputClassName, ...input }: FieldProps) {
  return (
    <FormField id={id} label={label} hint={hint} error={error} invalid={invalid} describedBy={describedBy} className={className}>
      {(control) => <Input {...input} {...control} className={inputClassName} />}
    </FormField>
  );
}
