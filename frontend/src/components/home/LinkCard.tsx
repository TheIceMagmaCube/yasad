import { useId } from "react";

import type { HomeLink } from "@/api";
import type { CategoryTone } from "@/lib/category-tone";
import { cn } from "@/lib/utils";

import { LinkIcon } from "./LinkIcon";

/**
 * Card of one link. Only the title is the anchor, so its name is the text it shows (WCAG 2.5.3); its ::after spreads
 * over the whole card, which stays one click target opening the service in the same tab (Ctrl+click and middle click
 * still open a new one). The description describes the anchor. `tone` colours the icon tile and the relief base.
 */
export function LinkCard({ link, tone, className }: { link: HomeLink; tone: CategoryTone; className?: string }) {
  const id = useId();
  const descriptionId = link.description ? `${id}-description` : undefined;
  return (
    <div
      className={cn(
        "relief relative flex h-full items-start gap-3 rounded-(--radius-card) bg-card p-4 text-card-foreground [--relief-ring:var(--border)] has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-4 has-[a:focus-visible]:outline-ring",
        tone.card,
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
    </div>
  );
}
