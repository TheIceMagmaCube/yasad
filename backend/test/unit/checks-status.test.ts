import { describe, expect, it } from "vitest";

import { publicStatus, STALE_INTERVALS, staleAfterMinutes } from "../../src/checks/status";

describe("staleAfterMinutes", () => {
  it("is three intervals", () => {
    expect(STALE_INTERVALS).toBe(3);
    expect(staleAfterMinutes(5)).toBe(15);
    expect(staleAfterMinutes(1)).toBe(3);
  });
});

describe("publicStatus", () => {
  const checkedAt = new Date("2026-10-20T08:00:00.000Z");
  const minutes = (n: number) => checkedAt.getTime() + n * 60_000;

  it("keeps the stored state, with the check time and the time it goes stale", () => {
    for (const state of ["up", "down", "unknown"] as const) {
      expect(publicStatus({ state, checkedAt }, minutes(1), 5)).toEqual({
        state,
        checkedAt: "2026-10-20T08:00:00.000Z",
        staleAt: "2026-10-20T08:15:00.000Z",
      });
    }
  });

  it("reads unknown, without times, before the first check", () => {
    expect(publicStatus({ state: null, checkedAt: null }, minutes(0), 5)).toEqual({ state: "unknown", checkedAt: null, staleAt: null });
  });

  it("reads unknown after three intervals, keeping the check time", () => {
    expect(publicStatus({ state: "up", checkedAt }, minutes(15), 5).state).toBe("up");
    for (const at of [minutes(15) + 1, minutes(600)]) {
      expect(publicStatus({ state: "up", checkedAt }, at, 5)).toEqual({
        state: "unknown",
        checkedAt: "2026-10-20T08:00:00.000Z",
        staleAt: "2026-10-20T08:15:00.000Z",
      });
    }
    expect(publicStatus({ state: "down", checkedAt }, minutes(60), 20).state).toBe("down");
    expect(publicStatus({ state: "down", checkedAt }, minutes(60) + 1, 20).state).toBe("unknown");
  });
});
