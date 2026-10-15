import type { InputHTMLAttributes } from "react";

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
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      <input
        id={id}
        name={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`mt-1 block w-full rounded-md border px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 ${
          error ? "border-red-700" : "border-zinc-400"
        }`}
        {...input}
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-zinc-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function SubmitButton({ children, busy }: { children: string; busy: boolean }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="mt-6 w-full rounded-md bg-zinc-900 px-4 py-2 font-semibold text-white outline-none hover:bg-zinc-700 focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 disabled:opacity-60"
    >
      {children}
    </button>
  );
}
