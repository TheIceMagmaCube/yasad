import { Hono } from "hono";

import { emptyState, type HomeCategory, type HomeEmpty, type Viewer, visibleCatalog } from "../access";
import { sessionFor } from "../auth";
import type { AppEnv } from "../context";

/** Body of `GET /api/home`. `empty` is set only when `categories` is empty and someone is signed in. */
export type HomeResponse = { signedIn: boolean; categories: HomeCategory[]; empty: HomeEmpty | null };

export const home = new Hono<AppEnv>();

/** Return the links the viewer may see; public, with or without a session. */
home.get("/", async (c) => {
  const current = await sessionFor(c);
  const viewer: Viewer = current
    ? { kind: "user", userId: current.user.id, role: current.user.role === "admin" ? "admin" : "user" }
    : { kind: "anonymous" };
  const categories = await visibleCatalog(c.var.db, viewer);
  const empty = categories.length === 0 ? await emptyState(c.var.db, viewer) : null;
  // The body depends on the cookie: no shared cache may keep it.
  c.header("Cache-Control", "private, no-store");
  return c.json({ signedIn: current !== null, categories, empty } satisfies HomeResponse);
});
