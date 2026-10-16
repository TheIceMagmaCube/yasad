import { describe, expect, it } from "vitest";

import { parseKeywords } from "../../src/catalog/format";

describe("parseKeywords", () => {
  it("returns the stored strings in order", () => {
    expect(parseKeywords('["email", "Équipe", "straße"]')).toEqual(["email", "Équipe", "straße"]);
  });

  it("returns [] for null, empty, invalid JSON or a value that is not an array", () => {
    for (const text of [null, undefined, "", "not json", "{}", '"email"', "42", "null"]) expect(parseKeywords(text)).toEqual([]);
  });

  it("drops items that are not non-empty strings", () => {
    expect(parseKeywords('["ok", 1, null, "", true, {"a": 1}, ["x"], "fine"]')).toEqual(["ok", "fine"]);
  });
});
