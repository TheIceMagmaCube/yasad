import { describe, expect, it } from "vitest";

import { matchesFilter, prepareFilter } from "./filter";

describe("matchesFilter", () => {
  it("ignores case and accents", () => {
    expect(matchesFilter("helene", "Hélène Boucher")).toBe(true);
    expect(matchesFilter("HÉLÈNE", "helene@example.invalid")).toBe(true);
  });

  it("requires every word, each in any of the texts", () => {
    expect(matchesFilter("grace example", "Grace Hopper", "grace@example.invalid")).toBe(true);
    expect(matchesFilter("grace ada", "Grace Hopper", "grace@example.invalid")).toBe(false);
  });

  it("matches inside words, so part of an e-mail address finds it", () => {
    expect(matchesFilter("ample", "grace@example.invalid")).toBe(true);
  });

  it("matches everything with an empty or blank query", () => {
    expect(matchesFilter("", "Grace")).toBe(true);
    expect(matchesFilter("  ", "Grace")).toBe(true);
  });
});

describe("prepareFilter", () => {
  it("filters items in their order, by the same rule", () => {
    const people = [
      { name: "Hélène", email: "h@example.invalid" },
      { name: "Grace", email: "grace@example.invalid" },
      { name: "Helen", email: "helen@example.invalid" },
    ];
    const filter = prepareFilter(people, (p) => [p.name, p.email]);
    expect(filter("hele").map((p) => p.name)).toEqual(["Hélène", "Helen"]);
    expect(filter("")).toEqual(people);
  });
});
