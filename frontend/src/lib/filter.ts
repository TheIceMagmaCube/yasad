import { fold, queryWords } from "./search";

/**
 * Return whether every word of `query` appears in one of `texts`, ignoring case and accents. An empty query
 * matches everything.
 */
export function matchesFilter(query: string, ...texts: string[]): boolean {
  const words = queryWords(query);
  if (words.length === 0) return true;
  const haystack = texts.map(fold);
  return words.every((word) => haystack.some((text) => text.includes(word)));
}

/** Return a filter over items whose texts are folded once, for lists filtered on every key press. */
export function prepareFilter<T>(items: readonly T[], textsOf: (item: T) => string[]): (query: string) => T[] {
  const folded = items.map((item) => ({ item, texts: textsOf(item).map(fold) }));
  return (query) => {
    const words = queryWords(query);
    if (words.length === 0) return [...items];
    return folded.filter(({ texts }) => words.every((word) => texts.some((text) => text.includes(word)))).map(({ item }) => item);
  };
}
