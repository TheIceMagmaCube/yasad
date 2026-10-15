import { ApiError } from "../api";
import type { Messages } from "./en";

/** Return the message for an error no screen handles specifically, chosen from its code. */
export function errorMessage(err: unknown, m: Messages): string {
  if (!(err instanceof ApiError)) return m.errors.unreachable;
  if (err.body.code === "rate_limited" || err.status === 429) return m.errors.rateLimited;
  return m.errors.generic;
}

/** Return the message for a field error code sent by the API. */
export function fieldErrorMessage(code: string, m: Messages): string {
  return (m.fieldErrors as Record<string, string>)[code] ?? m.errors.generic;
}
