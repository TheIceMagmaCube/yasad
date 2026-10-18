import { ApiError } from "../../api";
import type { Messages } from "../../i18n/en";
import { errorMessage, fieldErrorMessage } from "../../i18n/errors";

/** Return the text for an error of the admin API: its own messages first, then field and generic ones. */
export function adminErrorText(err: unknown, m: Messages): string {
  if (!(err instanceof ApiError)) return errorMessage(err, m);
  const own = (m.admin.errors as Record<string, string>)[err.body.code];
  if (own) return own;
  const field = Object.values(err.body.fields ?? {})[0];
  return field ? fieldErrorMessage(field, m) : errorMessage(err, m);
}

/** Return whether the API said the item an action targets no longer exists. */
export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.body.code === "not_found";
}
