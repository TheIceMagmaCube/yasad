import { ArrowDown, ArrowUp, X } from "lucide-react";
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

/** The manage mode of the viewer's own panel. */
type ManageProps = {
  managing: boolean;
  /** Open or close the manage mode. */
  onToggle(): void;
  toggleRef: Ref<HTMLButtonElement>;
  gestures: PinGestures;
  /** Error of the last gesture; a new `n` focuses it again. */
  error: { text: string; n: number } | null;
};

type PinsPanelProps = {
  categories: HomeCategory[];
  /** Ids of the visible pinned links, in their order. */
  pins: string[];
  /** Id of the categories' container, the target of the skip link. */
  skipTarget?: string;
  /** Name of the aside, when it is not the viewer's own favourites. */
  label?: string;
  /** Element of the panel title: h3 inside an h2 section. */
  level?: "h2" | "h3";
} & (ManageProps | { [K in keyof ManageProps]?: never });

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
 *
 * In the manage mode each favourite gets Up, Down and Remove, which go under the title when the row is too narrow.
 * At either end the move is aria-disabled, so it keeps its place in the tab order and the focus.
 *
 * Without `onToggle` the panel is read only, for a preview of someone else's home page: no Manage button, no
 * gesture, nothing written.
 */
export function PinsPanel({ categories, pins, skipTarget = "home-links", label, level, managing = false, onToggle, toggleRef, gestures, error = null }: PinsPanelProps) {
  const m = useStrings().home.pins;
  const items = pinnedLinks(categories, pins);
  return (
    <div className="pins-panel panel p-4 lg:col-start-2 lg:row-start-1 lg:self-start">
      <aside aria-label={label ?? m.title}>
        <SkipLink target={skipTarget} label={m.skipToLinks} inline />
        <SectionHeader
          title={m.title}
          level={level}
          className="mb-3"
          actions={
            onToggle && (
              <Button id="pins-toggle" ref={toggleRef} variant="outline" aria-label={managing ? m.doneName : m.manageName} onClick={onToggle}>
                {managing ? m.done : m.manage}
              </Button>
            )
          }
        />
        {error && (
          <Alert key={error.n} variant="destructive" autoFocus className="mb-3">
            {error.text}
          </Alert>
        )}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{!onToggle ? m.none : managing ? m.emptyManaging : m.invite}</p>
        ) : (
          <ul role="list" className="flex flex-col divide-y divide-border">
            {items.map(({ link, categoryIndex }, index) => (
              <li key={link.id} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1.5 py-1.5">
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
                {managing && gestures && <RowActions link={link} first={index === 0} last={index === items.length - 1} gestures={gestures} />}
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

/** Up, Down and Remove of one favourite in the manage mode; each button is `pending` while its gesture waits. */
function RowActions({ link, first, last, gestures }: { link: HomeLink; first: boolean; last: boolean; gestures: PinGestures }) {
  const m = useStrings().home.pins;
  const moves = [
    { direction: "up", id: `pin-up-${link.id}`, edge: first, label: m.moveUp(link.title), text: m.moveUpShort, Icon: ArrowUp },
    { direction: "down", id: `pin-down-${link.id}`, edge: last, label: m.moveDown(link.title), text: m.moveDownShort, Icon: ArrowDown },
  ] as const;
  const removeId = `pin-remove-${link.id}`;
  return (
    <div className="ml-auto flex flex-wrap gap-1">
      {moves.map(({ direction, id, edge, label, text, Icon }) => (
        <Button
          key={direction}
          id={id}
          variant="outline"
          className="px-3"
          aria-label={label}
          // Set only at an end: the button's own aria-disabled marks it pending otherwise.
          {...(edge ? { "aria-disabled": true } : {})}
          pending={gestures.isPending(id)}
          onClick={() => !edge && gestures.move(link.id, direction, id)}
        >
          <Icon aria-hidden="true" />
          <span className="max-sm:sr-only">{text}</span>
        </Button>
      ))}
      <Button id={removeId} variant="outline" className="px-3" aria-label={m.remove(link.title)} pending={gestures.isPending(removeId)} onClick={() => gestures.remove(link.id)}>
        <X aria-hidden="true" />
        <span className="max-sm:sr-only">{m.removeShort}</span>
      </Button>
    </div>
  );
}
