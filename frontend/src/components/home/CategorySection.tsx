import { useId } from "react";

import type { HomeCategory, HomeLink } from "@/api";
import { categoryTone } from "@/lib/category-tone";

import { SectionHeader } from "../SectionHeader";
import { type CardPin, LinkCard } from "./LinkCard";

/** Grid of the link cards: one column at 320 px, two from sm, three from lg. */
export const LINK_GRID = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3";

/** Grid of the link cards beside the favourites panel, which takes 16rem from lg: three columns only from xl. */
export const PANEL_LINK_GRID = "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3";

/**
 * Region of one category, named by its heading (h2 unless `level` says otherwise), with its links as a list of cards. `index` is the category's position in
 * the list the person receives and picks its colour. `grid` gives the classes of the card list (`LINK_GRID` by default).
 * `pin`, given only in the manage mode of the favourites, returns the pin button of each card.
 */
export function CategorySection({
  category,
  index,
  grid = LINK_GRID,
  pin,
  level,
}: {
  category: HomeCategory;
  index: number;
  grid?: string;
  pin?: (link: HomeLink) => CardPin;
  level?: "h2" | "h3";
}) {
  const id = useId();
  const tone = categoryTone(index);
  return (
    <section aria-labelledby={id}>
      <SectionHeader
        id={id}
        level={level}
        title={
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className={`pixel-corners size-4 shrink-0 ${tone.bar}`} />
            <span className="min-w-0">{category.title}</span>
          </span>
        }
      />
      <ul role="list" className={grid}>
        {category.links.map((link) => (
          <li key={link.id} className="min-w-0">
            <LinkCard link={link} tone={tone} pin={pin?.(link)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
