import { createElement, Fragment, type ReactNode } from "react";

import type { AdminLink, CheckSettings } from "../../../api";
import { SectionHeader } from "../../../components/SectionHeader";
import { useLocale } from "../../../i18n/LocaleProvider";
import { type CheckState, effectiveStatus, statusIcon } from "../../../lib/link-status";
import { formatRelative } from "../../../lib/relative-time";
import { cn } from "../../../lib/utils";

const TONES: Record<CheckState, string> = {
  up: "text-success",
  down: "text-destructive",
  unknown: "text-muted-foreground",
};

type LinkStatusProps = {
  link: Pick<AdminLink, "id" | "check" | "status">;
  checks: CheckSettings | null;
  /** The instant staleness is judged at, the one the list uses; 0 when the check settings are not read yet. */
  now: number;
};

/**
 * Last check of a checked link, read only: the state as a word and an icon shape, the reason and HTTP code, and when
 * it was checked. Nothing for an unchecked link. Not a live region: it changes only with a save the page announces.
 */
export function LinkStatus({ link, checks, now }: LinkStatusProps) {
  const { language, messages: m } = useLocale();
  const s = m.links.status;
  const status = effectiveStatus(link, checks, now);
  if (status === null) return null;

  const reasons: Record<string, string | undefined> = s.reasons;
  const detail = [status.reason === null ? null : (reasons[status.reason] ?? s.reasons.other), status.httpStatus === null ? null : s.httpStatus(status.httpStatus)]
    .filter((part) => part !== null)
    .join(", ");
  const when = status.checkedAt === null ? null : formatRelative(status.checkedAt, language, m, now > 0 ? now : undefined);
  const titleId = `link-${link.id}-status`;
  const rows: [string, ReactNode][] = [
    [
      s.state,
      <span className="inline-flex items-center gap-2">
        {createElement(statusIcon(status.state), { "aria-hidden": true, className: cn("size-4 shrink-0 forced-colors:text-[CanvasText]", TONES[status.state]) })}
        <span className={cn(status.state === "down" && "font-semibold")}>{s.states[status.state]}</span>
      </span>,
    ],
  ];
  if (detail) rows.push([s.detail, detail]);
  if (when) {
    rows.push([
      s.checked,
      <time dateTime={status.checkedAt ?? undefined} title={when.exact ?? undefined}>
        {when.text}
      </time>,
    ]);
  }

  return (
    <section aria-labelledby={titleId}>
      <SectionHeader id={titleId} title={s.title} />
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-y-3">
        {rows.map(([term, value]) => (
          <Fragment key={term}>
            <dt className="text-sm text-muted-foreground">{term}</dt>
            <dd className="mb-2 wrap-anywhere sm:mb-0">{value}</dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}
