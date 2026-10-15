import { eq, lt, sql } from "drizzle-orm";

import type { DB } from "./db";
import { rateLimit } from "./schema";

export type Limit = { max: number; windowMs: number };

const FIFTEEN_MINUTES = 15 * 60 * 1000;
/** Rows whose window started longer ago than this are deleted when a failure is recorded. */
const PURGE_AFTER_MS = 24 * 60 * 60 * 1000 + FIFTEEN_MINUTES;

export const SETUP_LIMIT: Limit = { max: 5, windowMs: FIFTEEN_MINUTES };
export const SIGN_IN_ACCOUNT_LIMIT: Limit = { max: 5, windowMs: FIFTEEN_MINUTES };
export const SIGN_IN_IP_LIMIT: Limit = { max: 30, windowMs: FIFTEEN_MINUTES };
export const PASSWORD_CHANGE_LIMIT: Limit = { max: 5, windowMs: FIFTEEN_MINUTES };

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
 * Rows left by windows that ended more than a day ago are deleted, so the table stays bounded.
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
  await db.delete(rateLimit).where(lt(rateLimit.windowStart, now - PURGE_AFTER_MS));
  return row!.count;
}

/** Forget the failures recorded for `key`. */
export async function clearFailures(db: DB, key: string): Promise<void> {
  await db.delete(rateLimit).where(eq(rateLimit.key, key));
}
