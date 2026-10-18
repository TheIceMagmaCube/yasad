/**
 * Classes of one category colour: the icon tile (solid fill, on-fill glyph), the section bar, and the card, whose
 * relief base takes the fill.
 */
export type CategoryTone = { tile: string; bar: string; card: string };

// Literal class strings, so Tailwind finds them in the source.
const TONES: readonly CategoryTone[] = [
  { tile: "bg-category-1-fill text-on-fill", bar: "bg-category-1-fill", card: "[--relief-color:var(--category-1-fill)]" },
  { tile: "bg-category-2-fill text-on-fill", bar: "bg-category-2-fill", card: "[--relief-color:var(--category-2-fill)]" },
  { tile: "bg-category-3-fill text-on-fill", bar: "bg-category-3-fill", card: "[--relief-color:var(--category-3-fill)]" },
  { tile: "bg-category-4-fill text-on-fill", bar: "bg-category-4-fill", card: "[--relief-color:var(--category-4-fill)]" },
  { tile: "bg-category-5-fill text-on-fill", bar: "bg-category-5-fill", card: "[--relief-color:var(--category-5-fill)]" },
  { tile: "bg-category-6-fill text-on-fill", bar: "bg-category-6-fill", card: "[--relief-color:var(--category-6-fill)]" },
];

/** Return the colour classes of the category at `index` in the list the person receives, cycling through the six tokens. */
export function categoryTone(index: number): CategoryTone {
  return TONES[((index % TONES.length) + TONES.length) % TONES.length]!;
}
