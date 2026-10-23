import { Pin } from "lucide-react";
import { createElement, useId } from "react";

import type { HomeLink, HomeLinkStatus } from "@/api";
import type { CategoryTone } from "@/lib/category-tone";
import { type CheckState, statusIcon } from "@/lib/link-status";
import { formatRelative } from "@/lib/relative-time";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

import { useLocale, useStrings } from "../../i18n/LocaleProvider";
import { Button } from "../ui/button";
import { LinkIcon } from "./LinkIcon";

/**
 * Pin button of a card in the manage mode. `id` is the button's element id (`pin-card-<link id>`), also the id of
 * its gestures in the queue; `pending` holds it while one is queued or in flight.
 */
export type CardPin = { pinned: boolean; pending: boolean; onToggle(): void; id: string };

const ICON_TONES: Record<CheckState, string> = {
  up: "text-success",
  down: "text-destructive",
  unknown: "text-muted-foreground",
};

/** Return the state to show: a result read stays valid until `staleAt`, then reads unknown, as on the server. */
function shownState(status: HomeLinkStatus, now: number): CheckState {
  return status.staleAt !== null && now > Date.parse(status.staleAt) ? "unknown" : status.state;
}

/**
 * Status of a checked link: an icon shape, a word and when it was checked, after a visually hidden "Status:" so the
 * anchor's description reads as a sentence. Only the icon takes the tone; the words keep a text colour, as success
 * is too light for text. The time has no title: the anchor's ::after covers it, so a tooltip would never show.
 */
function StatusLine({ id, status, state, now, className }: { id: string; status: HomeLinkStatus; state: CheckState; now: number; className: string }) {
  const { language, messages } = useLocale();
  const m = messages.home.status;
  const down = state === "down";
  return (
    <span id={id} className={cn("text-caption", className)}>
      <span className="sr-only">{m.label}</span>{" "}
      {createElement(statusIcon(state), {
        "aria-hidden": true,
        className: cn("mr-1 inline-block size-3.5 align-[-0.125rem] forced-colors:text-[CanvasText]", ICON_TONES[state]),
      })}
      <span className={cn(down && "font-bold text-foreground")}>{m[state]}</span>
      {/* Read as a comma, seen as a middle dot. */}
      <span className="sr-only">,</span> <span aria-hidden="true">· </span>
      {status.checkedAt === null ? (
        m.notCheckedYet
      ) : (
        <time dateTime={status.checkedAt}>{m.checkedAt(formatRelative(status.checkedAt, language, messages, now).text)}</time>
      )}
    </span>
  );
}

/**
 * Card of one link. Only the title is the anchor, so its name is the text it shows (WCAG 2.5.3); its ::after spreads
 * over the whole card, which stays one click target opening the service in the same tab (Ctrl+click and middle click
 * still open a new one). The description describes the anchor, then the status of a checked link: a short line under
 * the description while it is up or unknown, a band across the bottom of the card while it is down. `tone` colours
 * the icon tile and the relief base.
 *
 * With `pin` (manage mode only), a Pin or Pinned button takes its own row at the bottom, above the anchor's ::after
 * so it stays its own target, with its own focus ring. Its name starts with the word it shows (WCAG 2.5.3), so it has
 * no aria-pressed: the word, the filled icon and the selected marker show the state. Without `pin` the card is the
 * same as outside the mode.
 */
export function LinkCard({ link, tone, className, pin }: { link: HomeLink; tone: CategoryTone; className?: string; pin?: CardPin }) {
  const m = useStrings().home.pins;
  const id = useId();
  // Every card reads the one shared clock, so an open page ages its statuses without asking the server again.
  const now = useNow(60_000);
  const descriptionId = link.description ? `${id}-description` : undefined;
  const status = link.status;
  const state = status && shownState(status, now);
  const statusId = status ? `${id}-status` : undefined;
  const describedBy = [descriptionId, statusId].filter(Boolean).join(" ") || undefined;
  const band = state === "down";
  return (
    <div
      className={cn(
        "relief relative flex h-full items-start gap-3 rounded-(--radius-card) bg-card p-4 text-card-foreground [--relief-ring:var(--border)] has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-4 has-[a:focus-visible]:outline-ring",
        tone.card,
        (pin || band) && "flex-wrap",
        band && "content-between",
        className,
      )}
    >
      <LinkIcon icon={link.icon} title={link.title} className={tone.tile} />
      <span className="min-w-0 flex-1">
        <a
          href={link.url}
          aria-describedby={describedBy}
          className="block font-heading font-bold wrap-anywhere outline-none after:absolute after:inset-0 after:rounded-(--radius-card) after:content-['']"
        >
          {link.title}
        </a>
        {link.description && (
          <span id={descriptionId} className="mt-1 block text-sm wrap-anywhere text-muted-foreground">
            {link.description}
          </span>
        )}
        {status && state && !band && <StatusLine id={statusId!} status={status} state={state} now={now} className="mt-1 block text-muted-foreground" />}
      </span>
      {pin && (
        <div className="relative z-10 basis-full">
          <Button
            id={pin.id}
            variant="outline"
            className={cn("min-h-11 w-full focus-visible:ring-2 focus-visible:ring-ring", pin.pinned && "inset-shadow-[0_-3px_0_var(--selected)]")}
            aria-label={pin.pinned ? m.pinnedName(link.title) : m.pinName(link.title)}
            pending={pin.pending}
            onClick={pin.onToggle}
          >
            <Pin aria-hidden="true" className={cn(pin.pinned && "fill-current")} />
            {pin.pinned ? m.pinned : m.pin}
          </Button>
        </div>
      )}
      {status && band && (
        // Not positioned, so it stays under the anchor's ::after and a click on it opens the link. A flex item is as
        // wide as its basis, which negative margins do not widen: the basis adds back the card's padding.
        <StatusLine
          id={statusId!}
          status={status}
          state="down"
          now={now}
          className="-mx-4 -mb-4 block basis-[calc(100%+2rem)] rounded-b-(--radius-card) border-t border-destructive bg-destructive-surface px-4 py-2 text-foreground"
        />
      )}
    </div>
  );
}
