import type { Ref } from "react";

import type { HomeCategory, HomeLink } from "@/api";
import { categoryTone } from "@/lib/category-tone";
import { cn } from "@/lib/utils";

import { useStrings } from "../../i18n/LocaleProvider";
import { SectionHeader } from "../SectionHeader";
import { SkipLink } from "../SkipLink";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { LinkIcon } from "./LinkIcon";

/**
 * The pin gestures the panel asks for in the manage mode. `buttonId` names the button pressed, which stays pending
 * while its gesture is queued or in flight.
 */
export type PinGestures = {
  move(id: string, direction: "up" | "down", buttonId: string): void;
  remove(id: string): void;
  isPending(buttonId: string): boolean;
};

type PinsPanelProps = {
  categories: HomeCategory[];
  /** Ids of the visible pinned links, in their order. */
  pins: string[];
  managing: boolean;
  /** Open or close the manage mode. */
  onToggle(): void;
  toggleRef: Ref<HTMLButtonElement>;
  gestures: PinGestures;
  /** Error of the last gesture; a new `n` focuses it again. */
  error: { text: string; n: number } | null;
};

/**
 * Return the pinned links in `pins` order, each with the index of its category in `categories` (which picks its
 * colour). An id that no category holds is dropped.
 */
export function pinnedLinks(categories: HomeCategory[], pins: string[]): { link: HomeLink; categoryIndex: number }[] {
  const byId = new Map<string, { link: HomeLink; categoryIndex: number }>();
  categories.forEach((category, categoryIndex) => {
    for (const link of category.links) byId.set(link.id, { link, categoryIndex });
  });
  return pins.flatMap((id) => byId.get(id) ?? []);
}

/**
 * Favourites panel of the home page: right of the categories from lg, above them on smaller screens, and first in
 * the DOM, so it opens with a skip link to the categories (`#home-links`).
 *
 * The outer element is the grid item: from 64rem wide and 48rem high it sticks under the header and scrolls inside
 * (index.css, `.pins-panel`). It is the scroller, so it carries no role, name or tabindex; the aside inside it is the
 * landmark. Each favourite is a link with its icon and a marker in its category's current colour. Without one, a
 * short invitation takes the list's place; the one Manage button sits in the panel header.
 */
export function PinsPanel({ categories, pins, managing, onToggle, toggleRef, error }: PinsPanelProps) {
  const m = useStrings().home.pins;
  const items = pinnedLinks(categories, pins);
  return (
    <div className="pins-panel panel p-4 lg:col-start-2 lg:row-start-1 lg:self-start">
      <aside aria-label={m.title}>
        <SkipLink target="home-links" label={m.skipToLinks} inline />
        <SectionHeader
          title={m.title}
          className="mb-3"
          actions={
            <Button id="pins-toggle" ref={toggleRef} variant="outline" aria-label={managing ? m.doneName : m.manageName} onClick={onToggle}>
              {managing ? m.done : m.manage}
            </Button>
          }
        />
        {error && (
          <Alert key={error.n} variant="destructive" autoFocus className="mb-3">
            {error.text}
          </Alert>
        )}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{managing ? m.emptyManaging : m.invite}</p>
        ) : (
          <ul role="list" className="flex flex-col divide-y divide-border">
            {items.map(({ link, categoryIndex }) => (
              <li key={link.id} className="flex min-h-11 items-center gap-3 py-1.5">
                <LinkIcon icon={link.icon} title={link.title} className="size-8 bg-muted text-foreground [&_[data-initial]]:text-lg [&_svg]:size-5" />
                <a
                  href={link.url}
                  className="min-w-0 flex-1 rounded-sm font-semibold wrap-anywhere text-foreground decoration-link-decoration decoration-2 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {link.title}
                </a>
                <span
                  aria-hidden="true"
                  data-slot="pin-category"
                  className={cn("size-3 shrink-0 rounded-[2px] forced-colors:border", categoryTone(categoryIndex).bar)}
                />
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
