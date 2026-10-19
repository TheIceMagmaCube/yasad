import type { Context, MiddlewareHandler } from "hono";

import type { Auditor } from "../audit";
import { sessionFor } from "../auth";
import type { AppEnv } from "../context";
import { apiError } from "../errors";

/** Refuse the request unless an admin is signed in: 401 without a session, 403 for other users. */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const current = await sessionFor(c);
  if (!current) return apiError(c, 401, "unauthenticated", "Sign in first.");
  if (current.user.role !== "admin") return apiError(c, 403, "forbidden", "Only administrators can do this.");
  await next();
};

/** Return the signed-in admin as the author of audit entries; call it behind {@link requireAdmin}. */
export async function auditorOf(c: Context<AppEnv>): Promise<Auditor> {
  return { db: c.var.db, actorId: (await sessionFor(c))!.user.id, retentionDays: c.var.config.auditRetentionDays };
}
