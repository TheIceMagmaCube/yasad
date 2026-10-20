import { type SQL, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";

import { type UserViewer, visibleLink, visiblePinCount, visiblePins } from "../access";
import { failWhen, retrying } from "../audit";
import { ID } from "../catalog/format";
import type { AppEnv } from "../context";
import { apiError } from "../errors";
import { userLinkPin } from "../schema";
import { readJson } from "./body";
import { requireUser } from "./require-user";
import { viewerOf } from "./viewer";

/** The most visible pins a person may hold; hidden pins do not count. */
export const MAX_PINS = 20;

/** Body of every successful answer: the ids of the person's visible pins, in pin order. */
export type PinsResponse = { pins: string[] };

export const pins = new Hono<AppEnv>();

// The answers depend on the session: no shared cache may keep them, errors included.
pins.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "private, no-store");
});
pins.use("*", requireUser);

/** Return the signed-in person; call it behind {@link requireUser}. */
async function userOf(c: Context<AppEnv>): Promise<UserViewer> {
  const viewer = await viewerOf(c);
  if (viewer.kind !== "user") throw new Error("pins routes run behind requireUser");
  return viewer;
}

const notFound = (c: Context<AppEnv>) => apiError(c, 404, "not_found", "No such link.");

/** Return whether `condition`, an expression needing no FROM, holds now. */
async function holds(c: Context<AppEnv>, condition: SQL): Promise<boolean> {
  const row = await c.var.db.get<{ v: number }>(sql`select ${condition} as v`);
  return Boolean(row?.v);
}

/**
 * Pin a link at the end of the person's pins, after the hidden ones too, so positions stay unique.
 *
 * Pinning a link already pinned answers the order unchanged. A missing, inactive or forbidden link gives
 * the same 404; visibility is read again before the cap, so `pins_full` only answers for a visible link.
 */
pins.post("/", async (c) => {
  const db = c.var.db;
  const viewer = await userOf(c);
  const { userId } = viewer;
  const parsed = ID.safeParse((await readJson(c)).linkId);
  if (!parsed.success) return apiError(c, 422, "invalid_input", "Some fields are not valid.", { fields: { linkId: "invalid" } });
  const linkId = parsed.data;

  return retrying(async (last) => {
    try {
      await db.batch([
        failWhen(db, sql`not ${visibleLink(db, viewer, linkId)}`),
        failWhen(
          db,
          sql`${visiblePinCount(db, viewer)} >= ${MAX_PINS} and not exists (select 1 from user_link_pin where user_id = ${userId} and link_id = ${linkId})`,
        ),
        // The WHERE is required: without it SQLite would read ON CONFLICT as a join constraint.
        db
          .insert(userLinkPin)
          .select(sql`select ${userId}, ${linkId}, coalesce(max(position) + 1, 0), unixepoch() * 1000 from user_link_pin where user_id = ${userId}`)
          .onConflictDoNothing(),
      ]);
    } catch (err) {
      if (!(await holds(c, visibleLink(db, viewer, linkId)))) return notFound(c);
      if (await holds(c, sql`${visiblePinCount(db, viewer)} >= ${MAX_PINS}`)) {
        return apiError(c, 409, "pins_full", "You already have the most favourites allowed.", { max: MAX_PINS });
      }
      if (last) throw err;
      return "retry";
    }
    return c.json({ pins: await visiblePins(db, viewer) } satisfies PinsResponse);
  });
});
