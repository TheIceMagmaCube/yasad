import { eq, sql } from "drizzle-orm";

import type { DB } from "./db";
import { rateLimit } from "./schema";

export type Limit = { max: number; windowMs: number };

export const SETUP_LIMIT: Limit = { max: 5, windowMs: 15 * 60 * 1000 };

/** Return the failures recorded for `key` in the current window and the time until it ends. */
export async function failuresInWindow(db: DB, key: string, limit: Limit, now = Date.now()) {
  const row = await db.select().from(rateLimit).where(eq(rateLimit.key, key)).get();
  if (!row || row.windowStart <= now - limit.windowMs) return { count: 0, retryAfterMs: 0 };
  return { count: row.count, retryAfterMs: row.windowStart + limit.windowMs - now };
}

/**
 * Record one failure for `key` and return the new count.
 *
 * A single upsert statement, so concurrent requests are all counted. An expired window restarts at 1.
 */
export async function recordFailure(db: DB, key: string, limit: Limit, now = Date.now()): Promise<number> {
  const expired = now - limit.windowMs;
  const [row] = await db
    .insert(rateLimit)
    .values({ key, count: 1, windowStart: now })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        count: sql`case when ${rateLimit.windowStart} <= ${expired} then 1 else ${rateLimit.count} + 1 end`,
        windowStart: sql`case when ${rateLimit.windowStart} <= ${expired} then ${now} else ${rateLimit.windowStart} end`,
      },
    })
    .returning({ count: rateLimit.count });
  return row!.count;
}
