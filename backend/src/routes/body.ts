import type { Context } from "hono";

/** Return the JSON object the request sends, or an empty one for a missing, invalid or non-object body. */
export async function readJson(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}
