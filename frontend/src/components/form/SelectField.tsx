import type { ComponentProps, ReactNode } from "react";

import { NativeSelect } from "@/components/ui/native-select";

import { type FieldState, FormField } from "./FormField";

type SelectFieldProps = FieldState &
  Omit<ComponentProps<typeof NativeSelect>, "id"> & {
    label: ReactNode;
    hint?: ReactNode;
  };

/** Render a labelled native select; see {@link FormField}. */
export function SelectField({ id, label, hint, error, invalid, describedBy, className, ...select }: SelectFieldProps) {
  return (
    <FormField id={id} label={label} hint={hint} error={error} invalid={invalid} describedBy={describedBy} className={className}>
      {(control) => <NativeSelect {...select} {...control} />}
    </FormField>
  );
}
