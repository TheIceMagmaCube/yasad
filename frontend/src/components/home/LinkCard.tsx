import { Pin } from "lucide-react";
import { useId } from "react";

import type { HomeLink } from "@/api";
import type { CategoryTone } from "@/lib/category-tone";
import { cn } from "@/lib/utils";

import { useStrings } from "../../i18n/LocaleProvider";
import { Button } from "../ui/button";
import { LinkIcon } from "./LinkIcon";

/**
 * Pin button of a card in the manage mode. `id` is the button's element id (`pin-card-<link id>`), also the id of
 * its gestures in the queue; `pending` holds it while one is queued or in flight.
 */
export type CardPin = { pinned: boolean; pending: boolean; onToggle(): void; id: string };

/**
 * Card of one link. Only the title is the anchor, so its name is the text it shows (WCAG 2.5.3); its ::after spreads
 * over the whole card, which stays one click target opening the service in the same tab (Ctrl+click and middle click
 * still open a new one). The description describes the anchor. `tone` colours the icon tile and the relief base.
 *
 * With `pin` (manage mode only), a Pin or Pinned button takes its own row at the bottom, above the anchor's ::after
 * so it stays its own target, with its own focus ring. Its name starts with the word it shows (WCAG 2.5.3), so it has
 * no aria-pressed: the word, the filled icon and the selected marker show the state. Without `pin` the card is the
 * same as outside the mode.
 */
export function LinkCard({ link, tone, className, pin }: { link: HomeLink; tone: CategoryTone; className?: string; pin?: CardPin }) {
  const m = useStrings().home.pins;
  const id = useId();
  const descriptionId = link.description ? `${id}-description` : undefined;
  return (
    <div
      className={cn(
        "relief relative flex h-full items-start gap-3 rounded-(--radius-card) bg-card p-4 text-card-foreground [--relief-ring:var(--border)] has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-4 has-[a:focus-visible]:outline-ring",
        tone.card,
        pin && "flex-wrap",
        className,
      )}
    >
      <LinkIcon icon={link.icon} title={link.title} className={tone.tile} />
      <span className="min-w-0 flex-1">
        <a
          href={link.url}
          aria-describedby={descriptionId}
          className="block font-heading font-bold wrap-anywhere outline-none after:absolute after:inset-0 after:rounded-(--radius-card) after:content-['']"
        >
          {link.title}
        </a>
        {link.description && (
          <span id={descriptionId} className="mt-1 block text-sm wrap-anywhere text-muted-foreground">
            {link.description}
          </span>
        )}
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
    </div>
  );
}
