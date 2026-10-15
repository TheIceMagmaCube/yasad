// Paths are relative to the frontend workspace, where Vitest runs (import.meta.url is not a file: URL under jsdom).
import { readFile, readdir } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { isDark, LANGUAGES, readPreference, resolveLanguage, THEMES } from "./preferences";

describe("resolveLanguage", () => {
  it("prefers the person's choice", () => {
    expect(resolveLanguage("fr", ["en-US"], "en")).toBe("fr");
  });

  it("then takes the first supported browser language by its primary subtag", () => {
    expect(resolveLanguage(null, ["de-DE", "fr-CA", "en"], "en")).toBe("fr");
  });

  it("then falls back to the instance default", () => {
    expect(resolveLanguage(null, ["de-DE", "es"], "fr")).toBe("fr");
  });
});

describe("isDark", () => {
  it("follows the system only in system mode", () => {
    expect(isDark("system", true)).toBe(true);
    expect(isDark("system", false)).toBe(false);
    expect(isDark("light", true)).toBe(false);
    expect(isDark("dark", false)).toBe(true);
  });
});

describe("readPreference", () => {
  it("ignores values outside the allowed list", () => {
    localStorage.setItem("yasad.mode", "sepia");
    expect(readPreference("mode", ["system", "light", "dark"])).toBeNull();
  });
});

describe("theme and language lists", () => {
  it("match the theme files and public/theme-init.js", async () => {
    const files = await readdir("src/theme/themes");
    expect(files.map((f) => f.replace(/\.css$/, "")).sort()).toEqual([...THEMES].sort());
    const init = await readFile("public/theme-init.js", "utf8");
    expect(init).toContain(`var THEMES = ${JSON.stringify(THEMES).replaceAll(",", ", ")};`);
    expect(init).toContain(`var LANGUAGES = ${JSON.stringify(LANGUAGES).replaceAll(",", ", ")};`);
  });
});
