import { describe, expect, it } from "vitest";

import { STALE_INTERVALS, staleAfterMinutes } from "../../src/checks/status";

describe("staleAfterMinutes", () => {
  it("is three intervals", () => {
    expect(STALE_INTERVALS).toBe(3);
    expect(staleAfterMinutes(5)).toBe(15);
    expect(staleAfterMinutes(1)).toBe(3);
  });
});
