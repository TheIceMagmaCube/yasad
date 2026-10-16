import { describe, expect, it } from "vitest";

import type { HomeCategory, HomeLink } from "@/api";

import { buildIndex, excerpt, fold, foldChar, queryWords, search, words } from "./search";

/** Return a link with defaults for what the test does not care about. */
function link(id: string, title: string, extra: Partial<HomeLink> = {}): HomeLink {
  return { id, title, description: "", url: `https://${id}.example.invalid/`, icon: null, keywords: [], ...extra };
}

function category(id: string, links: HomeLink[]): HomeCategory {
  return { id, title: `Category ${id}`, links };
}

/** Return the ids of the links found for `query`, in order. */
function ids(categories: HomeCategory[], query: string, limit?: number): string[] {
  return search(buildIndex(categories), query, limit).results.map((r) => r.link.id);
}

/** Return the source text covered by each range. */
function covered(text: string, ranges: readonly (readonly [number, number])[]): string[] {
  return ranges.map(([s, e]) => text.slice(s, e));
}

describe("fold", () => {
  it("ignores case and accents, in NFC as in NFD", () => {
    expect(fold("Équipe")).toBe("equipe");
    expect(fold("Équipe")).toBe("equipe");
    expect(fold("Ça VA")).toBe("ca va");
    expect(fold("Équipe".normalize("NFC"))).toBe(fold("Équipe".normalize("NFD")));
  });

  it.each([
    ["ß", "ss"],
    ["ẞ", "ss"],
    ["æ", "ae"],
    ["Æ", "ae"],
    ["œ", "oe"],
    ["Œ", "oe"],
    ["ø", "o"],
    ["Ø", "o"],
    ["ł", "l"],
    ["Ł", "l"],
    ["đ", "d"],
    ["Đ", "d"],
    ["ð", "d"],
    ["þ", "th"],
    ["Þ", "th"],
    ["ı", "i"],
  ])("folds %s to %s", (char, folded) => {
    expect(foldChar(char)).toBe(folded);
  });

  it("folds the Turkish dotted and dotless I to i, whatever the locale", () => {
    expect(fold("İstanbul")).toBe("istanbul");
    expect(fold("ISPARTA")).toBe("isparta");
    expect(fold("ılık")).toBe("ilik");
  });
});

describe("words", () => {
  it("splits on spaces, punctuation, symbols and emoji", () => {
    expect(words("a b,c.d/e_f@g'h (i) j+k 🙂l", { join: false }).map((w) => w.text)).toEqual(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"]);
  });

  it("keeps the source bounds across ß and dropped combining marks", () => {
    const text = "Große Équipe";
    const [grosse, equipe] = words(text, { join: false });
    expect(grosse!.text).toBe("grosse");
    expect(text.slice(grosse!.start, grosse!.marks.at(-1)!.end)).toBe("Große");
    expect(equipe!.text).toBe("equipe");
    expect(text.slice(equipe!.start, equipe!.marks.at(-1)!.end)).toBe("Équipe");
  });

  it("also indexes words joined by a single hyphen, whole chains included", () => {
    expect(words("E-mail").map((w) => w.text)).toEqual(["e", "mail", "email"]);
    expect(words("Wi-Fi-6").map((w) => w.text)).toEqual(["wi", "fi", "6", "wifi6"]);
  });

  it("does not join across a space, two hyphens or another separator", () => {
    expect(words("e - mail").map((w) => w.text)).toEqual(["e", "mail"]);
    expect(words("e--mail").map((w) => w.text)).toEqual(["e", "mail"]);
    expect(words("e_mail").map((w) => w.text)).toEqual(["e", "mail"]);
  });

  it("does not split camelCase", () => {
    expect(words("GitLab").map((w) => w.text)).toEqual(["gitlab"]);
  });

  it("gives no word for a query of spaces or punctuation only", () => {
    expect(queryWords("  - / . ")).toEqual([]);
  });
});

describe("search, matching", () => {
  const data = [
    category("a", [
      link("mail", "Mail", { description: "Company mailbox", keywords: ["webmail", "courrier"] }),
      link("gitlab", "GitLab", { description: "Code and merge requests" }),
      link("elearning", "Équipe e-learning"),
    ]),
  ];

  it("needs every query word", () => {
    expect(ids(data, "mail courrier")).toEqual(["mail"]);
    expect(ids(data, "mail gitlab")).toEqual([]);
  });

  it("matches prefixes of words only, never inner substrings", () => {
    expect(ids(data, "ma")).toEqual(["mail"]);
    expect(ids(data, "ail")).toEqual([]);
    expect(ids(data, "lab")).toEqual([]);
  });

  it("lets words match in different fields", () => {
    expect(ids(data, "mail company")).toEqual(["mail"]);
    expect(ids(data, "merge git")).toEqual(["gitlab"]);
  });

  it("ignores accents and joins hyphenated words", () => {
    expect(ids(data, "equipe")).toEqual(["elearning"]);
    expect(ids(data, "ÉQUIPE")).toEqual(["elearning"]);
    expect(ids(data, "elearning")).toEqual(["elearning"]);
    expect(ids(data, "e-learning")).toEqual(["elearning"]);
  });

  it("finds nothing for an empty query or one without words", () => {
    expect(search(buildIndex(data), "")).toEqual({ results: [], total: 0 });
    expect(search(buildIndex(data), " -- ")).toEqual({ results: [], total: 0 });
  });

  it("treats a repeated word as one", () => {
    expect(ids(data, "mail mail")).toEqual(["mail"]);
    expect(queryWords("Mail mail MAIL")).toEqual(["mail"]);
  });
});

describe("search, ranking", () => {
  it("puts title matches before keyword matches before description matches", () => {
    const data = [
      category("a", [
        link("by-description", "Alpha", { description: "Vpn access for the office" }),
        link("by-keyword", "Bravo", { keywords: ["vpn"] }),
        link("by-title", "Charlie VPN"),
      ]),
    ];
    expect(search(buildIndex(data), "vpn").results.map((r) => [r.link.id, r.level])).toEqual([
      ["by-title", 0],
      ["by-keyword", 1],
      ["by-description", 2],
    ]);
  });

  it("puts a title starting with the first query word first within a level", () => {
    const data = [category("a", [link("team-mail", "Team mail"), link("mail", "Mail")])];
    expect(ids(data, "mail")).toEqual(["mail", "team-mail"]);
  });

  it("counts a hyphenated first word as the start of the title", () => {
    const data = [category("a", [link("old", "Old e-mail"), link("email", "E-mail")])];
    expect(ids(data, "email")).toEqual(["email", "old"]);
  });

  it("keeps catalog order on a tie, across categories", () => {
    const data = [category("b", [link("b1", "Wiki one"), link("b2", "Wiki two")]), category("a", [link("a1", "Wiki three")])];
    expect(ids(data, "wiki")).toEqual(["b1", "b2", "a1"]);
  });

  it("gives the same order on every run", () => {
    const data = [category("a", Array.from({ length: 30 }, (_, i) => link(`l${i}`, i % 2 ? `Docs ${i}` : `My docs ${i}`)))];
    const first = ids(data, "docs", 30);
    for (let i = 0; i < 5; i++) expect(ids(data, "docs", 30)).toEqual(first);
    expect(first.slice(0, 15).every((id) => Number(id.slice(1)) % 2 === 1)).toBe(true);
  });

  it("returns `limit` results and the total count", () => {
    const data = [category("a", Array.from({ length: 12 }, (_, i) => link(`l${i}`, `Tool ${i}`)))];
    const found = search(buildIndex(data), "tool");
    expect(found.total).toBe(12);
    expect(found.results).toHaveLength(8);
    expect(search(buildIndex(data), "tool", 3).results.map((r) => r.link.id)).toEqual(["l0", "l1", "l2"]);
  });

  it("builds the index once per categories array", () => {
    const data = [category("a", [link("mail", "Mail")])];
    expect(buildIndex(data)).toBe(buildIndex(data));
    expect(buildIndex([...data])).not.toBe(buildIndex(data));
  });
});

describe("search, highlights", () => {
  it("highlights the matched prefix of each word, merging overlaps", () => {
    const [result] = search(buildIndex([category("a", [link("mail", "Mail and mailbox")])]), "mai mailb").results;
    expect(covered(result!.title.text, result!.title.ranges)).toEqual(["Mai", "mailb"]);
  });

  it("covers whole source characters: é in NFC and NFD, ß, and a mark at the end", () => {
    const one = (title: string, query: string) => {
      const [r] = search(buildIndex([category("a", [link("x", title)])]), query).results;
      return covered(r!.title.text, r!.title.ranges);
    };
    expect(one("Équipe", "e")).toEqual(["É"]);
    expect(one("Équipe", "e")).toEqual(["É"]);
    expect(one("Straße", "stras")).toEqual(["Straß"]);
    expect(one("Strasse", "stras")).toEqual(["Stras"]);
    expect(one("Café", "cafe")).toEqual(["Café"]);
  });

  it("highlights across the hyphen of a joined word", () => {
    const [r] = search(buildIndex([category("a", [link("x", "E-mail")])]), "email").results;
    expect(covered(r!.title.text, r!.title.ranges)).toEqual(["E-mail"]);
  });

  it("shows the keyword that matched a word the title does not", () => {
    const [r] = search(buildIndex([category("a", [link("mail", "Mail", { keywords: ["webmail", "courrier"] })])]), "mail cour").results;
    expect(r!.keyword?.text).toBe("courrier");
    expect(covered(r!.keyword!.text, r!.keyword!.ranges)).toEqual(["cour"]);
    expect(r!.excerpt).toBeUndefined();
  });

  it("shows no keyword or excerpt when the title matches every word", () => {
    const [r] = search(buildIndex([category("a", [link("mail", "Mail", { keywords: ["mail"], description: "mail" })])]), "mail").results;
    expect(r!.keyword).toBeUndefined();
    expect(r!.excerpt).toBeUndefined();
  });

  it("shows an excerpt of the description from the word boundary before the match", () => {
    const description = "A long description that talks about many unrelated things before it finally mentions the backup server and then goes on for a while, long enough to be cut again at the end.";
    const [r] = search(buildIndex([category("a", [link("x", "Tool", { description })])]), "backup").results;
    expect(r!.excerpt!.text.startsWith("…backup server")).toBe(true);
    expect(r!.excerpt!.text.endsWith("…")).toBe(true);
    expect(covered(r!.excerpt!.text, r!.excerpt!.ranges)).toEqual(["backup"]);
  });

  it("starts the excerpt at the word boundary even when the match is inside a hyphenated word", () => {
    const long = `Use the e-learning portal ${"and more ".repeat(10)}`;
    const cut = excerpt(long, 10, [[10, 18]]);
    expect(cut.text.startsWith("…e-learning portal")).toBe(true);
    expect(cut.ranges).toEqual([[3, 11]]);
  });

  it("shows the match when it sits deep in a token without spaces, such as a URL", () => {
    const description = `See https://example.com/${"a".repeat(90)}/vpnconfig for details`;
    const [r] = search(buildIndex([category("a", [link("x", "Tool", { description })])]), "vpnconf").results;
    expect(r!.level).toBe(2);
    expect(r!.excerpt!.text.startsWith("…vpnconfig for details")).toBe(true);
    expect(covered(r!.excerpt!.text, r!.excerpt!.ranges)).toEqual(["vpnconf"]);
  });

  it("starts at the match itself when its word is too long to walk back over", () => {
    const long = `${"x".repeat(60)}-vpnconfig ${"and more ".repeat(10)}`;
    const cut = excerpt(long, 61, [[61, 68]]);
    expect(cut.text.startsWith("…vpnconfig")).toBe(true);
    expect(cut.ranges).toEqual([[1, 8]]);
  });

  it("cuts a highlight longer than the excerpt to it", () => {
    const long = `go ${"b".repeat(100)}`;
    const cut = excerpt(long, 3, [[3, 103]]);
    expect(cut.ranges).toEqual([[1, 81]]);
  });

  it("never splits a character made of two UTF-16 units, or a letter from its marks", () => {
    // No space after the match: the cut falls at 80 units, inside the pair of the 39th emoji.
    const emoji = excerpt(`zet${"😀".repeat(50)}`, 0, [[0, 3]]);
    expect(emoji.text).toBe(`zet${"😀".repeat(38)}…`);
    expect(emoji.ranges).toEqual([[0, 3]]);
    // The cut at 80 falls between an "e" and its accent.
    const marks = excerpt(`z${"e\u0301".repeat(50)}`, 0, [[0, 1]]);
    expect(marks.text).toBe(`z${"e\u0301".repeat(39)}…`);
  });

  it("returns a short description whole", () => {
    expect(excerpt("Use the e-learning portal", 8, [[8, 18]])).toEqual({ text: "Use the e-learning portal", ranges: [[8, 18]] });
  });
});
