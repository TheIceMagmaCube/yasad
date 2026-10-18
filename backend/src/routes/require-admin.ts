import type { MiddlewareHandler } from "hono";

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
