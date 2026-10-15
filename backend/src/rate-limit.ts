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

export type Attempt = { allowed: boolean; count: number; retryAfterMs: number };

/**
 * Count one attempt for `key` before checking it, and return whether it may go on.
 *
 * Reserving first, in a single upsert, keeps parallel requests from all passing a check made before
 * any of them is counted. An expired window restarts at 1. Call releaseAttempt when the attempt
 * turns out right, so only failures stay counted. Rows left by windows that ended more than a day
 * ago are deleted, so the table stays bounded.
 */
export async function reserveAttempt(db: DB, key: string, limit: Limit, now = Date.now()): Promise<Attempt> {
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
    .returning({ count: rateLimit.count, windowStart: rateLimit.windowStart });
  await db.delete(rateLimit).where(lt(rateLimit.windowStart, now - PURGE_AFTER_MS));
  return { allowed: row!.count <= limit.max, count: row!.count, retryAfterMs: row!.windowStart + limit.windowMs - now };
}

/** Give back an attempt reserved for `key` that was not a failure. */
export async function releaseAttempt(db: DB, key: string): Promise<void> {
  await db
    .update(rateLimit)
    .set({ count: sql`max(${rateLimit.count} - 1, 0)` })
    .where(eq(rateLimit.key, key));
}

/** Forget the attempts recorded for `key`. */
export async function clearAttempts(db: DB, key: string): Promise<void> {
  await db.delete(rateLimit).where(eq(rateLimit.key, key));
}
