/** Classes of one category colour: the icon tile (tinted surface, coloured glyph) and the section bar. */
export type CategoryTone = { tile: string; bar: string };

// Literal class strings, so Tailwind finds them in the source.
const TONES: readonly CategoryTone[] = [
  { tile: "bg-category-1/12 text-category-1", bar: "bg-category-1" },
  { tile: "bg-category-2/12 text-category-2", bar: "bg-category-2" },
  { tile: "bg-category-3/12 text-category-3", bar: "bg-category-3" },
  { tile: "bg-category-4/12 text-category-4", bar: "bg-category-4" },
  { tile: "bg-category-5/12 text-category-5", bar: "bg-category-5" },
  { tile: "bg-category-6/12 text-category-6", bar: "bg-category-6" },
];

/** Return the colour classes of the category at `index` in the list the person receives, cycling through the six tokens. */
export function categoryTone(index: number): CategoryTone {
  return TONES[((index % TONES.length) + TONES.length) % TONES.length]!;
}
