import type { HomeCategory, HomeLink } from "@/api";

/** A range of source text, as UTF-16 offsets `[start, end)`, always covering whole source characters. */
export type Range = readonly [start: number, end: number];

/**
 * One word of a field, folded, with where it sits in the source text.
 *
 * `marks[i]` says that the first `marks[i].length` folded characters end at source offset `marks[i].end`: a
 * prefix highlight then stops at the end of a whole source character, a "ß" or a letter with its marks included.
 */
type Word = { text: string; start: number; marks: { length: number; end: number }[] };

/** A searchable text: the source and its words, hyphen-joined forms included. */
type Field = { source: string; words: Word[] };

type Entry = {
  link: HomeLink;
  category: HomeCategory;
  categoryIndex: number;
  title: Field;
  keywords: Field[];
  description: Field;
};

/** Links of one home answer, prepared for {@link search}. */
export type SearchIndex = { entries: Entry[] };

/** Text shown with a result, and the ranges of it to highlight. */
export type Highlighted = { text: string; ranges: Range[] };

export type SearchResult = {
  link: HomeLink;
  category: HomeCategory;
  /** Position of the category in the list the person receives, for its colour. */
  categoryIndex: number;
  /** 0: every word matched in the title; 1: in the title or a keyword; 2: one needed the description. */
  level: 0 | 1 | 2;
  title: Highlighted;
  /** The first keyword matching a word the title does not, if any. */
  keyword?: Highlighted;
  /** At level 2 without such a keyword: an extract of the description around the first match. */
  excerpt?: Highlighted;
};

/** Letters NFD does not decompose, after lower-casing. */
const FOLD_TABLE: Record<string, string> = { ß: "ss", æ: "ae", œ: "oe", ø: "o", ł: "l", đ: "d", ð: "d", þ: "th", ı: "i" };
const MARKS = /\p{M}/gu;
const WORD_CHAR = /[\p{L}\p{N}]/u;
/** Hyphen-minus, hyphen and non-breaking hyphen: one of them alone between two words joins them. */
const HYPHENS = new Set(["-", "‐", "‑"]);

/**
 * Fold one source character: decompose, drop combining marks, lower-case without locale (so the Turkish I gives
 * the same results whatever the interface language), then map the letters left whole.
 */
export function foldChar(char: string): string {
  const lower = char.normalize("NFD").replace(MARKS, "").toLowerCase().replace(MARKS, "");
  let out = "";
  for (const c of lower) out += FOLD_TABLE[c] ?? c;
  return out;
}

/** Fold a whole text, character by character. */
export function fold(text: string): string {
  let out = "";
  for (const char of text) out += foldChar(char);
  return out;
}

/**
 * Split a text into folded words: maximal runs of letters and digits, anything else separating. Combining marks
 * stay with the letter before them. With `join`, two runs separated by a single hyphen and nothing else are also
 * indexed together, the whole chain at once ("Wi-Fi-6" also gives "wifi6"). camelCase is not split.
 */
export function words(text: string, { join = true }: { join?: boolean } = {}): Word[] {
  const runs: Word[] = [];
  let current: Word | null = null;
  let offset = 0;
  for (const char of text) {
    const start = offset;
    offset += char.length;
    const folded = foldChar(char);
    if (folded === "") {
      // A combining mark (or anything folding to nothing): part of the word it follows.
      if (current) current.marks[current.marks.length - 1]!.end = offset;
      continue;
    }
    for (const c of folded) {
      if (WORD_CHAR.test(c)) {
        current ??= { text: "", start, marks: [] };
        current.text += c;
        current.marks.push({ length: current.text.length, end: offset });
      } else if (current) {
        runs.push(current);
        current = null;
      }
    }
  }
  if (current) runs.push(current);
  if (!join) return runs;

  const all = [...runs];
  let chain: Word[] = [];
  const flush = () => {
    if (chain.length > 1) all.push(joinWords(chain));
    chain = [];
  };
  runs.forEach((word, i) => {
    const previous = runs[i - 1];
    const linked = previous !== undefined && HYPHENS.has(text.slice(previous.marks.at(-1)!.end, word.start));
    if (!linked) flush();
    chain.push(word);
  });
  flush();
  return all;
}

/** Return one word made of a hyphen-linked chain, spanning it in the source. */
function joinWords(chain: Word[]): Word {
  let text = "";
  const marks: Word["marks"] = [];
  for (const word of chain) {
    for (const mark of word.marks) marks.push({ length: text.length + mark.length, end: mark.end });
    text += word.text;
  }
  return { text, start: chain[0]!.start, marks };
}

/** Return the distinct folded words of a query, without joined forms; an empty list means an empty query. */
export function queryWords(query: string): string[] {
  return [...new Set(words(query, { join: false }).map((w) => w.text))];
}

function field(source: string): Field {
  return { source, words: words(source) };
}

/** Return whether a word of the field starts with `q`. */
function matches(f: Field, q: string): boolean {
  return f.words.some((w) => w.text.startsWith(q));
}

/** Return the source range covering the first `length` folded characters of `word`. */
function prefixRange(word: Word, length: number): Range {
  const mark = word.marks.find((m) => m.length >= length) ?? word.marks.at(-1)!;
  return [word.start, mark.end];
}

/** Return the sorted, merged source ranges where the field's words start with one of `qs`. */
function rangesOf(f: Field, qs: string[]): Range[] {
  const found: Range[] = [];
  for (const word of f.words) {
    for (const q of qs) if (word.text.startsWith(q)) found.push(prefixRange(word, q.length));
  }
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const [start, end] of found) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

const indexes = new WeakMap<HomeCategory[], SearchIndex>();

/** Return the search index of a home answer, built once per categories array. */
export function buildIndex(categories: HomeCategory[]): SearchIndex {
  let index = indexes.get(categories);
  if (!index) {
    index = {
      entries: categories.flatMap((category, categoryIndex) =>
        category.links.map((link) => ({
          link,
          category,
          categoryIndex,
          title: field(link.title),
          keywords: link.keywords.map(field),
          description: field(link.description),
        })),
      ),
    };
    indexes.set(categories, index);
  }
  return index;
}

/** Number of characters an excerpt of the description aims for. */
export const EXCERPT_LENGTH = 80;
const ELLIPSIS = "…";
const MARK = /\p{M}/u;

/** Return the whole source character ending at `offset` (a surrogate pair counts as one). */
function charBefore(source: string, offset: number): string {
  const low = source.charCodeAt(offset - 1);
  const high = source.charCodeAt(offset - 2);
  return low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff ? source.slice(offset - 2, offset) : source.charAt(offset - 1);
}

/** Return `offset` moved back, if needed, so that it does not split a surrogate pair or a letter from its marks. */
function charBoundary(source: string, offset: number): number {
  let at = offset;
  const code = source.charCodeAt(at - 1);
  if (at < source.length && code >= 0xd800 && code <= 0xdbff) at -= 1;
  while (at > 0 && at < source.length && MARK.test(source[at]!)) at -= charBefore(source, at).length;
  return at;
}

/**
 * Return the start of the word holding `from`: back over letters, digits, marks and the single hyphens joining
 * them. A word too long to leave room for the match is not walked back over at all.
 */
function wordStart(source: string, from: number): number {
  let start = from;
  while (start > 0) {
    const previous = charBefore(source, start);
    const linked = HYPHENS.has(previous) && start > 1 && WORD_CHAR.test(charBefore(source, start - 1));
    if (!WORD_CHAR.test(previous) && !MARK.test(previous) && !linked) break;
    start -= previous.length;
  }
  return from - start > EXCERPT_LENGTH / 2 ? from : start;
}

/**
 * Return about {@link EXCERPT_LENGTH} characters of `source` from the start of the word holding `from`, with an
 * ellipsis where it is cut (a description that short is returned whole), and `ranges` moved into the excerpt
 * (cut to it, and dropped when outside). The excerpt never splits a source character.
 */
export function excerpt(source: string, from: number, ranges: Range[]): Highlighted {
  if (source.length <= EXCERPT_LENGTH) return { text: source, ranges };
  const start = wordStart(source, from);
  let end = Math.min(source.length, start + EXCERPT_LENGTH);
  if (end < source.length) {
    const space = source.lastIndexOf(" ", end);
    end = space > from ? space : charBoundary(source, end);
  }
  const head = start > 0 ? ELLIPSIS : "";
  const body = source.slice(start, end).trimEnd();
  const tail = end < source.length ? ELLIPSIS : "";
  const shift = head.length - start;
  const limit = start + body.length;
  const moved = ranges
    .map(([s, e]): Range => [Math.max(s, start), Math.min(e, limit)])
    .filter(([s, e]) => s < e)
    .map(([s, e]): Range => [s + shift, e + shift]);
  return { text: head + body + tail, ranges: moved };
}

type Match = { entry: Entry; level: 0 | 1 | 2; titleStart: 0 | 1; order: number };

/**
 * Return the first `limit` links matching `query`, best first, and how many match in all.
 *
 * Every query word must start a word of the title, a keyword or the description (not necessarily the same one).
 * Results are ordered by level, then by whether the title's first word starts with the first query word, then
 * in catalog order. Only the returned results get their highlights computed.
 */
export function search(index: SearchIndex, query: string, limit = 8): { results: SearchResult[]; total: number } {
  const qs = queryWords(query);
  if (qs.length === 0) return { results: [], total: 0 };
  const first = qs[0]!;
  const found: Match[] = [];
  index.entries.forEach((entry, order) => {
    let level: 0 | 1 | 2 = 0;
    for (const q of qs) {
      if (matches(entry.title, q)) continue;
      if (entry.keywords.some((k) => matches(k, q))) {
        if (level === 0) level = 1;
        continue;
      }
      if (matches(entry.description, q)) {
        level = 2;
        continue;
      }
      return;
    }
    const firstWord = entry.title.words[0];
    const titleStart = entry.title.words.some((w) => w.start === firstWord?.start && w.text.startsWith(first)) ? 0 : 1;
    found.push({ entry, level, titleStart, order });
  });
  found.sort((a, b) => a.level - b.level || a.titleStart - b.titleStart || a.order - b.order);
  return { results: found.slice(0, limit).map(({ entry, level }) => describe(entry, level, qs)), total: found.length };
}

/** Return the full result of a matched entry: highlights in the title, and the keyword or excerpt to show. */
function describe(entry: Entry, level: 0 | 1 | 2, qs: string[]): SearchResult {
  const result: SearchResult = {
    link: entry.link,
    category: entry.category,
    categoryIndex: entry.categoryIndex,
    level,
    title: { text: entry.title.source, ranges: rangesOf(entry.title, qs) },
  };
  const notInTitle = qs.filter((q) => !matches(entry.title, q));
  const keyword = entry.keywords.find((k) => notInTitle.some((q) => matches(k, q)));
  if (keyword) {
    result.keyword = { text: keyword.source, ranges: rangesOf(keyword, notInTitle) };
  } else if (level === 2) {
    const ranges = rangesOf(entry.description, notInTitle);
    result.excerpt = excerpt(entry.description.source, ranges[0]?.[0] ?? 0, ranges);
  }
  return result;
}
