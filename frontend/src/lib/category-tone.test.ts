import { describe, expect, it } from "vitest";

import { categoryTone } from "./category-tone";

describe("categoryTone", () => {
  it("starts with category-1 and cycles every six categories", () => {
    expect(categoryTone(0)).toEqual({ tile: "bg-category-1-fill text-on-fill", bar: "bg-category-1-fill", card: "[--relief-color:var(--category-1-fill)]" });
    expect(categoryTone(5).bar).toBe("bg-category-6-fill");
    expect(categoryTone(6)).toEqual(categoryTone(0));
    expect(categoryTone(13)).toEqual(categoryTone(1));
  });
});
