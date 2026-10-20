import type { Context } from "hono";

import type { Viewer } from "../access";
import { sessionFor } from "../auth";
import type { AppEnv } from "../context";

/** Return who is asking, from the session cookie: a signed-in person with their role, or anonymous. */
export async function viewerOf(c: Context<AppEnv>): Promise<Viewer> {
  const current = await sessionFor(c);
  return current ? { kind: "user", userId: current.user.id, role: current.user.role === "admin" ? "admin" : "user" } : { kind: "anonymous" };
}
