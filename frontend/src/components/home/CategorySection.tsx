import { useId } from "react";

import type { HomeCategory } from "@/api";
import { categoryTone } from "@/lib/category-tone";

import { SectionHeader } from "../SectionHeader";
import { LinkCard } from "./LinkCard";

/** Grid of the link cards: one column at 320 px, two from sm, three from lg. */
export const LINK_GRID = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3";

/**
 * Region of one category, named by its h2, with its links as a list of cards. `index` is the category's position in
 * the list the person receives and picks its colour.
 */
export function CategorySection({ category, index }: { category: HomeCategory; index: number }) {
  const id = useId();
  const tone = categoryTone(index);
  return (
    <section aria-labelledby={id}>
      <SectionHeader
        id={id}
        title={
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className={`h-5 w-1 shrink-0 rounded-full ${tone.bar}`} />
            <span className="min-w-0">{category.title}</span>
          </span>
        }
      />
      <ul role="list" className={LINK_GRID}>
        {category.links.map((link) => (
          <li key={link.id} className="min-w-0">
            <LinkCard link={link} tile={tone.tile} />
          </li>
        ))}
      </ul>
    </section>
  );
}
