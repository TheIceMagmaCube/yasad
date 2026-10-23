import { and, eq } from "drizzle-orm";

import { link, linkStatus } from "../schema";

/** Intervals after which a stored result is too old to trust. */
export const STALE_INTERVALS = 3;

/** Minutes after which a check result reads unknown, on the home page and in the administration. */
export function staleAfterMinutes(intervalMinutes: number): number {
  return STALE_INTERVALS * intervalMinutes;
}

/** The join condition of a link's built-in status row, the one the scheduler writes. */
export const ownStatus = and(eq(linkStatus.linkId, link.id), eq(linkStatus.source, "yasad"));

/** A check result as people who see the link get it: no reason, no HTTP status. */
export type PublicStatus = { state: "up" | "down" | "unknown"; checkedAt: string | null; staleAt: string | null };

/**
 * Return the status shown on the home page from the stored row, at `now` (ms).
 *
 * Never checked reads unknown without times. After `staleAt` (three intervals after the check) it reads
 * unknown with the check time kept, as the admin's `effectiveStatus` does, so a stopped scheduler never
 * leaves a link shown up; the browser applies the same `staleAt` while the page stays open.
 */
export function publicStatus(
  row: { state: PublicStatus["state"] | null; checkedAt: Date | null },
  now: number,
  intervalMinutes: number,
): PublicStatus {
  if (row.state === null || row.checkedAt === null) return { state: "unknown", checkedAt: null, staleAt: null };
  const staleAt = row.checkedAt.getTime() + staleAfterMinutes(intervalMinutes) * 60_000;
  return {
    state: now > staleAt ? "unknown" : row.state,
    checkedAt: row.checkedAt.toISOString(),
    staleAt: new Date(staleAt).toISOString(),
  };
}
