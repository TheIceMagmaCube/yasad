/** Intervals after which a stored result is too old to trust. */
export const STALE_INTERVALS = 3;

/** Minutes after which a check result reads unknown, on the home page and in the administration. */
export function staleAfterMinutes(intervalMinutes: number): number {
  return STALE_INTERVALS * intervalMinutes;
}
