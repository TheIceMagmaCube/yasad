import { describe, expect, it } from "vitest";

import { cachedInstance } from "./instance";

describe("cachedInstance", () => {
  it("keeps a cached preset theme", () => {
    localStorage.setItem("yasad.instanceTheme", "dusk");
    expect(cachedInstance().theme).toBe("dusk");
  });

  it("falls back to the default theme for a removed theme id", () => {
    localStorage.setItem("yasad.instanceTheme", "night");
    expect(cachedInstance().theme).toBe("default");
  });
});
