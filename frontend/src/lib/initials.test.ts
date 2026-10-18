import { describe, expect, it } from "vitest";

import { initialsOf } from "./initials";

describe("initialsOf", () => {
  it("takes the first letter of the first and last words, upper-cased in the interface language", () => {
    expect(initialsOf("Ada Lovelace", "en")).toBe("AL");
    expect(initialsOf("  marie  de la  fontaine ", "fr")).toBe("MF");
    expect(initialsOf("bob", "en")).toBe("B");
    expect(initialsOf("ilker", "tr")).toBe("İ");
  });

  it("keeps a character outside the basic plane whole, and gives ? for an empty name", () => {
    expect(initialsOf("𝒜da 𝒵oe", "en")).toBe("𝒜𝒵");
    expect(initialsOf("   ", "en")).toBe("?");
  });
});
