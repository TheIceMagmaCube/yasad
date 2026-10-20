import type { MiddlewareHandler } from "hono";

import { sessionFor } from "../auth";
import type { AppEnv } from "../context";
import { apiError } from "../errors";

/** Refuse the request unless someone is signed in, whatever their role: 401 without a session. */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!(await sessionFor(c))) return apiError(c, 401, "unauthenticated", "Sign in first.");
  await next();
};
