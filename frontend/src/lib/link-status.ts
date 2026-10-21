import { CircleCheck, CircleQuestionMark, CircleX, type LucideIcon } from "lucide-react";

import type { AdminLink, CheckSettings } from "@/api";

export type CheckState = "up" | "down" | "unknown";
/** The status a screen shows for a checked link: the stored result, or unknown when there is none or it is too old. */
export type EffectiveStatus = { state: CheckState; reason: string | null; httpStatus: number | null; checkedAt: string | null };

/**
 * The one rule for the status shown in the admin: null for an unchecked link, unknown (`not_checked_yet`) before the
 * first result, unknown (`stale`, time and HTTP status kept) once the result is older than the server's
 * `staleAfterMinutes`, else the stored result. Without the check settings a result never turns stale.
 */
export function effectiveStatus(link: Pick<AdminLink, "check" | "status">, checks: CheckSettings | null, now: number): EffectiveStatus | null {
  if (!link.check) return null;
  const status = link.status;
  if (status === null) return { state: "unknown", reason: "not_checked_yet", httpStatus: null, checkedAt: null };
  if (checks !== null && status.checkedAt !== null && now > Date.parse(status.checkedAt) + checks.staleAfterMinutes * 60_000) {
    return { state: "unknown", reason: "stale", httpStatus: status.httpStatus, checkedAt: status.checkedAt };
  }
  return status;
}

const ICONS: Record<CheckState, LucideIcon> = { up: CircleCheck, down: CircleX, unknown: CircleQuestionMark };

/** The shape of a status, so it never rests on colour alone. */
export function statusIcon(state: CheckState): LucideIcon {
  return ICONS[state];
}
