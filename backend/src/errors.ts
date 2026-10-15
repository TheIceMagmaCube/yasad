import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Return a JSON error response shaped `{ error: { code, message, ...details } }`. */
export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  return c.json({ error: { code, message, ...details } }, status);
}
