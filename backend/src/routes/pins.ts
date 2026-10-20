import { and, eq, type SQL, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";

import { linkVisibleWhere, type UserViewer, visibleLink, visiblePinCount, visiblePins } from "../access";
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

/** Body of a move: one step towards the start or the end of the person's visible pins. */
const DIRECTION = z.strictObject({ direction: z.enum(["up", "down"]) });

/** Return the link id of the path, or null when it is not a well-formed id. */
function pathId(c: Context<AppEnv>): string | null {
  const parsed = ID.safeParse(c.req.param("linkId"));
  return parsed.success ? parsed.data : null;
}

const invalidId = (c: Context<AppEnv>) => apiError(c, 422, "invalid_input", "Some fields are not valid.", { fields: { linkId: "invalid" } });

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
  if (!parsed.success) return invalidId(c);
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

/**
 * Remove one of the person's pins, visible or hidden. Any well-formed id answers 200 with the order,
 * so the answer says nothing about the link.
 */
pins.delete("/:linkId", async (c) => {
  const db = c.var.db;
  const viewer = await userOf(c);
  const linkId = pathId(c);
  if (linkId === null) return invalidId(c);
  await db.delete(userLinkPin).where(and(eq(userLinkPin.userId, viewer.userId), eq(userLinkPin.linkId, linkId)));
  return c.json({ pins: await visiblePins(db, viewer) } satisfies PinsResponse);
});

/**
 * Swap a pin with its visible neighbour, the previous one for `up` and the next one for `down`, in
 * `(position, link_id)` order. Hidden pins keep their position, so positions stay unique. At either end
 * nothing changes. A pin that is absent or no longer visible answers 404.
 */
pins.post("/:linkId/move", async (c) => {
  const db = c.var.db;
  const viewer = await userOf(c);
  const { userId } = viewer;
  const linkId = pathId(c);
  if (linkId === null) return invalidId(c);
  const parsed = DIRECTION.safeParse(await readJson(c));
  if (!parsed.success) return apiError(c, 422, "invalid_input", "Some fields are not valid.", { fields: { direction: "invalid" } });
  const step = parsed.data.direction === "up" ? -1 : 1;
  const movable = sql`(${visibleLink(db, viewer, linkId)} and exists (select 1 from user_link_pin where user_id = ${userId} and link_id = ${linkId}))`;

  return retrying(async (last) => {
    try {
      // `update ... from` reads the rows as they were before the statement, so both swapped values hold.
      await db.batch([
        failWhen(db, sql`not ${movable}`),
        db
          .update(userLinkPin)
          .set({ position: sql`s.next` })
          .from(
            sql`(
              with v as (
                select p.link_id, p.position, row_number() over (order by p.position, p.link_id) as r
                from user_link_pin p join link on link.id = p.link_id join category on category.id = link.category_id
                where p.user_id = ${userId} and ${linkVisibleWhere(db, viewer)}),
              me as (select * from v where link_id = ${linkId}),
              other as (select v.* from v, me where v.r = me.r + ${step})
              select me.link_id as link_id, other.position as next from me, other
              union all select other.link_id, me.position from me, other) as s`,
          )
          .where(sql`${userLinkPin.userId} = ${userId} and ${userLinkPin.linkId} = s.link_id`),
      ]);
    } catch (err) {
      if (!(await holds(c, movable))) return notFound(c);
      if (last) throw err;
      return "retry";
    }
    return c.json({ pins: await visiblePins(db, viewer) } satisfies PinsResponse);
  });
});
