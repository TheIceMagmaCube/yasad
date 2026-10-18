import { useId } from "react";

import type { HomeLink } from "@/api";
import { cn } from "@/lib/utils";

import { LinkIcon } from "./LinkIcon";

/**
 * Card of one link: the whole card is a plain anchor opening the service in the same tab (Ctrl+click and middle
 * click still open a new one). Its accessible name is the title, its description the link's description.
 * `tile` holds the category colour classes of the icon tile.
 */
export function LinkCard({ link, tile, className }: { link: HomeLink; tile: string; className?: string }) {
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = link.description ? `${id}-description` : undefined;
  return (
    <a
      href={link.url}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={cn(
        "relief flex h-full items-start gap-3 rounded-2xl bg-card p-4 text-card-foreground [--relief-ring:var(--border)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
        className,
      )}
    >
      <LinkIcon icon={link.icon} title={link.title} className={tile} />
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
