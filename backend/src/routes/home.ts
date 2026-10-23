import { Hono } from "hono";

import { emptyState, type HomeCategory, type HomeEmpty, type Viewer, visibleCatalog, visiblePins } from "../access";
import type { AppEnv } from "../context";
import type { DB } from "../db";
import { viewerOf } from "./viewer";

/**
 * Body of `GET /api/home`. `empty` is set only when `categories` is empty and someone is signed in.
 * `pins` lists the ids of the viewer's visible pinned links, in pin order; `[]` for anonymous.
 */
export type HomeResponse = { signedIn: boolean; categories: HomeCategory[]; empty: HomeEmpty | null; pins: string[] };

/**
 * Return the home page of `viewer` at `checks.now`. The only assembly of it: `GET /api/home` and the
 * administrators' preview both call it, so the preview is what the person gets.
 */
export async function homeOf(db: DB, viewer: Viewer, checks: { now: number; intervalMinutes: number }): Promise<HomeResponse> {
  const categories = await visibleCatalog(db, viewer, checks);
  const empty = categories.length === 0 ? await emptyState(db, viewer) : null;
  const pins = await visiblePins(db, viewer);
  return { signedIn: viewer.kind === "user", categories, empty, pins };
}

export const home = new Hono<AppEnv>();

/**
 * Return the links the viewer may see; public, with or without a session. Check results are only read from
 * the database: a slow or failing check never delays this answer.
 */
home.get("/", async (c) => {
  const body = await homeOf(c.var.db, await viewerOf(c), { now: Date.now(), intervalMinutes: c.var.config.statusChecks.intervalMinutes });
  // The body depends on the cookie: no shared cache may keep it.
  c.header("Cache-Control", "private, no-store");
  return c.json(body);
});
