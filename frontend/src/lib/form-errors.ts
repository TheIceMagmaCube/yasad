import { useCallback, useId, useMemo, useState } from "react";

import { ApiError } from "../api";
import type { Messages } from "../i18n/en";
import { errorMessage, fieldErrorMessage } from "../i18n/errors";
import { useStrings } from "../i18n/LocaleProvider";

/** A summary entry that links to a field without a message under it. */
export type FieldLink<F extends string> = { field: F; message: string };

/** What a failed submission reports: a title, and the problems of each field. */
export type FormFailure<F extends string> = {
  title: string;
  /** Message under each field, also linked from the summary. */
  fields: Partial<Record<F, string>>;
  /** Fields marked invalid without a message of their own: the summary title describes them. */
  invalid: F[];
  /** Summary links to a field that carries no message (re-type the password, for instance). */
  links: FieldLink<F>[];
  /** Problems that belong to no known field, listed in the summary without a link, so nothing is lost. */
  extra: string[];
};

/** How a known API error code is shown. */
export type CodeRule<F extends string> = {
  message: string | ((err: ApiError) => string);
  /** Field that shows the message. */
  field?: F;
  /** Other fields marked invalid. */
  invalid?: F[];
  /** Summary title; defaults to "Check the highlighted fields." with `field`, else to the message itself. */
  title?: string;
  link?: FieldLink<F>;
};

export type ApiFormErrorOptions<F extends string> = {
  /** Fields of the form, in display order. */
  fields: readonly F[];
  codes?: Partial<Record<string, CodeRule<F>>>;
  /** API field name to form field name, when they differ (`newPassword` to `new`). */
  rename?: Partial<Record<string, F>>;
  /** Message of any other error; defaults to {@link errorMessage}. */
  fallback?: (err: unknown, m: Messages) => string;
};

/**
 * Return how a form shows an API error, by these rules in order: a code of `codes` gives its message, on its
 * field if any; `invalid_input` puts each field code on its field (renamed if needed), an unknown key becoming a
 * summary entry without a link; anything else goes through the fallback.
 */
export function apiFormError<F extends string>(err: unknown, m: Messages, options: ApiFormErrorOptions<F>): FormFailure<F> {
  const empty: FormFailure<F> = { title: "", fields: {}, invalid: [], links: [], extra: [] };
  const code = err instanceof ApiError ? err.body.code : null;
  const rule = code ? options.codes?.[code] : undefined;
  if (rule && err instanceof ApiError) {
    const message = typeof rule.message === "function" ? rule.message(err) : rule.message;
    return {
      ...empty,
      title: rule.title ?? (rule.field ? m.forms.checkFields : message),
      fields: rule.field ? ({ [rule.field]: message } as Partial<Record<F, string>>) : {},
      invalid: rule.invalid ?? [],
      links: rule.link ? [rule.link] : [],
    };
  }
  if (code === "invalid_input" && err instanceof ApiError && err.body.fields && Object.keys(err.body.fields).length > 0) {
    const fields: Partial<Record<F, string>> = {};
    const extra: string[] = [];
    for (const [key, fieldCode] of Object.entries(err.body.fields)) {
      const name = options.rename?.[key] ?? key;
      const message = fieldErrorMessage(fieldCode, m);
      if ((options.fields as readonly string[]).includes(name)) fields[name as F] = message;
      else extra.push(message);
    }
    return { ...empty, title: m.forms.checkFields, fields, extra };
  }
  return { ...empty, title: (options.fallback ?? errorMessage)(err, m) };
}

/** The error state a form shows; `key` changes on every failure, so the summary takes the focus again. */
export type FormErrorState<F extends string> = FormFailure<F> & { key: number; order: readonly F[] };

/** What `field(name)` returns, to spread on a field component. */
export type FieldProps<F extends string> = { id: string; name: F; error?: string; invalid?: boolean; describedBy?: string };

export type FormErrors<F extends string> = {
  state: FormErrorState<F> | null;
  /** Id of the summary title, so a field marked invalid without a message can point at it. */
  titleId: string;
  /** Return the element id of a field. */
  fieldId: (field: F) => string;
  /** Return the id, name and error state of a field. */
  field: (field: F) => FieldProps<F>;
  /** Show a failure. */
  fail: (title: string, fields?: Partial<Record<F, string>>, options?: Partial<Pick<FormFailure<F>, "invalid" | "links" | "extra">>) => void;
  /** Show an API error, mapped by {@link apiFormError}. */
  failWith: (err: unknown, options?: Omit<ApiFormErrorOptions<F>, "fields">) => void;
  /**
   * Run the local checks in one pass: each entry is a message, or a falsy value when the field is fine. Show
   * every problem and return false when there is one; clear the errors and return true otherwise.
   */
  check: (rules: Partial<Record<F, string | false | null | undefined>>) => boolean;
  /** Drop the problems of a field that is no longer shown; clear the errors when nothing else is left. */
  clear: (field: F) => void;
  reset: () => void;
};

/**
 * Hold the errors of a form whose fields are given once, in display order. Errors stay shown until the next
 * submission, so the report stays stable for screen readers.
 */
export function useFormErrors<F extends string>(fields: readonly F[], formId?: string): FormErrors<F> {
  const m = useStrings();
  const generated = useId();
  const id = formId ?? generated;
  const [state, setState] = useState<FormErrorState<F> | null>(null);
  // The list is declared inline by callers: keep the first one.
  const [order] = useState(fields);

  const show = useCallback(
    (failure: FormFailure<F>) => setState((prev) => ({ ...failure, order, key: (prev?.key ?? 0) + 1 })),
    [order],
  );

  return useMemo<FormErrors<F>>(() => {
    const titleId = `${id}-summary-title`;
    const fieldId = (field: F) => `${id}-${field}`;
    return {
      state,
      titleId,
      fieldId,
      field: (field) => ({
        id: fieldId(field),
        name: field,
        error: state?.fields[field],
        invalid: state?.invalid.includes(field) || undefined,
        describedBy: state ? titleId : undefined,
      }),
      fail: (title, fieldErrors = {}, options = {}) =>
        show({ title, fields: fieldErrors, invalid: options.invalid ?? [], links: options.links ?? [], extra: options.extra ?? [] }),
      failWith: (err, options = {}) => show(apiFormError(err, m, { ...options, fields: order })),
      check: (rules) => {
        const problems = Object.fromEntries(Object.entries(rules).filter(([, message]) => message)) as Partial<Record<F, string>>;
        if (Object.keys(problems).length === 0) {
          setState(null);
          return true;
        }
        show({ title: m.forms.checkFields, fields: problems, invalid: [], links: [], extra: [] });
        return false;
      },
      clear: (field) =>
        setState((prev) => {
          if (!prev) return prev;
          const fields = { ...prev.fields };
          delete fields[field];
          const next = { ...prev, fields, invalid: prev.invalid.filter((f) => f !== field), links: prev.links.filter((l) => l.field !== field) };
          const empty = Object.keys(next.fields).length + next.invalid.length + next.links.length + next.extra.length === 0;
          return empty ? null : next;
        }),
      reset: () => setState(null),
    };
  }, [id, state, show, m, order]);
}

/** Length range of a password, as the server checks it. */
const PASSWORD_LENGTH = { min: 12, max: 128 } as const;

/** Return the problem of a new password, or null: required, then 12 to 128 characters. */
export function newPasswordProblem(password: string, m: Messages): string | null {
  if (password === "") return m.fieldErrors.required;
  if (password.length < PASSWORD_LENGTH.min || password.length > PASSWORD_LENGTH.max) return m.fieldErrors.invalid_password;
  return null;
}

/** Return the problem of a password confirmation, or null. */
export function confirmationProblem(password: string, confirmation: string, m: Messages): string | null {
  if (confirmation === "") return m.fieldErrors.required;
  return confirmation === password ? null : m.fieldErrors.password_mismatch;
}
