import type { Messages } from "../i18n/en";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Return a short date for a column: "3 h ago" under a day, "2 d ago" under a week, then the day ("on 20 Aug"), with
 * the year only when it is not the current one; `exact` is the full date and time, for the detail pane and `title`.
 */
export function formatRelative(iso: string | null, language: string, m: Messages, now = Date.now()): { text: string; exact: string | null } {
  if (iso === null) return { text: m.relative.never, exact: null };
  const date = new Date(iso);
  const exact = new Intl.DateTimeFormat(language, { dateStyle: "long", timeStyle: "short" }).format(date);
  const elapsed = now - date.getTime();
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: "always", style: "short" });
  if (elapsed < MINUTE) return { text: m.relative.justNow, exact };
  if (elapsed < HOUR) return { text: rtf.format(-Math.floor(elapsed / MINUTE), "minute"), exact };
  if (elapsed < DAY) return { text: rtf.format(-Math.floor(elapsed / HOUR), "hour"), exact };
  if (elapsed < 7 * DAY) return { text: rtf.format(-Math.floor(elapsed / DAY), "day"), exact };
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const day = new Intl.DateTimeFormat(language, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" }).format(date);
  return { text: m.relative.onDate(day), exact };
}
