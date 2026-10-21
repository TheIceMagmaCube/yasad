// Paths are relative to the frontend workspace, where Vitest runs (import.meta.url is not a file: URL under jsdom).
import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it } from "vitest";

import { ICONS_BASE } from "../icons-base";
import { FONT_CREDITS, ICON_CREDITS, ICON_NOTICE, LICENSE_NAMES } from "./credits";

let dependencies: Record<string, string> = {};
let css = "";

beforeAll(async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as { dependencies?: Record<string, string> };
  dependencies = pkg.dependencies ?? {};
  css = await readFile("src/index.css", "utf8");
});

describe("credits", () => {
  it("credits every self-hosted font package, and only packages the frontend depends on", () => {
    const fonts = Object.keys(dependencies).filter((name) => name.startsWith("@fontsource-variable/"));
    expect(fonts.length).toBeGreaterThan(0);
    const credited = FONT_CREDITS.map((c) => c.package);
    for (const name of fonts) expect(credited).toContain(name);
    for (const c of FONT_CREDITS) if (c.package !== null) expect(dependencies).toHaveProperty([c.package]);
  });

  it("credits Nabla, the vendored wordmark font declared in index.css", () => {
    expect(css).toMatch(/@font-face\s*\{[^}]*font-family:\s*"?Nabla"?\s*;/);
    expect(FONT_CREDITS.find((c) => c.id === "nabla")).toMatchObject({ package: null });
  });

  it("credits Lucide and Simple Icons", () => {
    expect(ICON_CREDITS.map((c) => c.id)).toEqual(expect.arrayContaining(["lucide", "simple-icons"]));
    expect(dependencies).toHaveProperty(["lucide-react"]);
    expect(ICON_CREDITS.find((c) => c.id === "lucide")).toMatchObject({ package: "lucide-react" });
  });

  it("names every font licence", () => {
    for (const c of FONT_CREDITS) expect(LICENSE_NAMES[c.license]).toBeTruthy();
  });

  it("gives unique ids and https project links", () => {
    const all = [...FONT_CREDITS, ...ICON_CREDITS];
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
    for (const c of all) expect(c.url).toMatch(/^https:\/\//);
  });

  it("points to the notice served next to the icons", () => {
    expect(ICON_NOTICE).toBe(`${ICONS_BASE}/NOTICE.txt`);
  });
});
