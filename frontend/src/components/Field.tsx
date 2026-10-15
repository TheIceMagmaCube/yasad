import type { InputHTMLAttributes } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
};

export function Field({ id, label, hint, error, ...input }: FieldProps) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="mt-4">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} className="mt-1.5" {...input} />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function SubmitButton({ children, busy }: { children: string; busy: boolean }) {
  return (
    <Button type="submit" disabled={busy} className="mt-6 w-full">
      {children}
    </Button>
  );
}
