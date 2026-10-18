import { useId } from "react";

import type { HomeLink } from "@/api";
import type { CategoryTone } from "@/lib/category-tone";
import { cn } from "@/lib/utils";

import { LinkIcon } from "./LinkIcon";

/**
 * Card of one link: the whole card is a plain anchor opening the service in the same tab (Ctrl+click and middle
 * click still open a new one). Its accessible name is the title, its description the link's description.
 * `tone` colours the icon tile and the relief base under the card.
 */
export function LinkCard({ link, tone, className }: { link: HomeLink; tone: CategoryTone; className?: string }) {
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = link.description ? `${id}-description` : undefined;
  return (
    <a
      href={link.url}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={cn(
        "relief flex h-full items-start gap-3 rounded-(--radius-card) bg-card p-4 text-card-foreground [--relief-ring:var(--border)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
        tone.card,
        className,
      )}
    >
      <LinkIcon icon={link.icon} title={link.title} className={tone.tile} />
      <span className="min-w-0 flex-1">
        <span id={titleId} className="block font-heading font-bold wrap-anywhere">
          {link.title}
        </span>
        {link.description && (
          <span id={descriptionId} className="mt-1 block text-sm wrap-anywhere text-muted-foreground">
            {link.description}
          </span>
        )}
      </span>
    </a>
  );
}
