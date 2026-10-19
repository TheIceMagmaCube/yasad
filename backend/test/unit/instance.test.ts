import { readdir } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { displayableLogo } from "../../src/routes/instance";
import { knownTheme, THEMES } from "../../src/themes";

describe("displayableLogo", () => {
  it("keeps same-origin paths and data:image URIs", () => {
    expect(displayableLogo("/logo.svg")).toBe("/logo.svg");
    expect(displayableLogo("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
  });

  it("drops what the CSP would block", () => {
    for (const value of [undefined, "", "https://cdn.example/logo.png", "//cdn.example/logo.png", "/\\cdn.example", "data:text/html,x", "logo.svg"]) {
      expect(displayableLogo(value)).toBeNull();
    }
  });
});

describe("THEMES", () => {
  it("matches the theme files of the frontend", async () => {
    const files = await readdir(new URL("../../../frontend/src/theme/themes/", import.meta.url));
    expect(files.filter((f) => f.endsWith(".css")).map((f) => f.slice(0, -4)).sort()).toEqual([...THEMES].sort());
  });

  it("maps a removed or unknown id to the default theme", () => {
    expect(knownTheme("dusk")).toBe("dusk");
    for (const value of ["night", "neon", "", undefined]) expect(knownTheme(value)).toBe("default");
  });
});
