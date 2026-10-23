import { Hono } from "hono";

import { emptyState, type HomeCategory, type HomeEmpty, visibleCatalog, visiblePins } from "../access";
import type { AppEnv } from "../context";
import { viewerOf } from "./viewer";

/**
 * Body of `GET /api/home`. `empty` is set only when `categories` is empty and someone is signed in.
 * `pins` lists the ids of the viewer's visible pinned links, in pin order; `[]` for anonymous.
 */
export type HomeResponse = { signedIn: boolean; categories: HomeCategory[]; empty: HomeEmpty | null; pins: string[] };

export const home = new Hono<AppEnv>();

/**
 * Return the links the viewer may see; public, with or without a session. Check results are only read from
 * the database: a slow or failing check never delays this answer.
 */
home.get("/", async (c) => {
  const viewer = await viewerOf(c);
  const categories = await visibleCatalog(c.var.db, viewer, { now: Date.now(), intervalMinutes: c.var.config.statusChecks.intervalMinutes });
  const empty = categories.length === 0 ? await emptyState(c.var.db, viewer) : null;
  const pins = await visiblePins(c.var.db, viewer);
  // The body depends on the cookie: no shared cache may keep it.
  c.header("Cache-Control", "private, no-store");
  return c.json({ signedIn: viewer.kind === "user", categories, empty, pins } satisfies HomeResponse);
});
