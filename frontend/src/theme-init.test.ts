// Paths are relative to the frontend workspace, where Vitest runs (import.meta.url is not a file: URL under jsdom).
import { readFile } from "node:fs/promises";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let script = "";

beforeAll(async () => {
  script = await readFile("public/theme-init.js", "utf8");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Run public/theme-init.js and return the attributes it sets on <html>. */
function run({ storage = {}, languages = ["en-US"], systemDark = false }: {
  storage?: Record<string, string>;
  languages?: string[];
  systemDark?: boolean;
}) {
  for (const [key, value] of Object.entries(storage)) localStorage.setItem(`yasad.${key}`, value);
  vi.stubGlobal("navigator", { languages, language: languages[0] });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: systemDark })));
  new Function(script)();
  const root = document.documentElement;
  return { theme: root.dataset.theme, mode: root.dataset.mode, lang: root.lang };
}

describe("public/theme-init.js", () => {
  it("uses the defaults on a first visit", () => {
    expect(run({})).toEqual({ theme: "default", mode: "light", lang: "en" });
  });

  it("applies the cached instance theme, the stored mode and language", () => {
    expect(run({ storage: { instanceTheme: "dusk", mode: "dark", language: "fr" } })).toEqual({ theme: "dusk", mode: "dark", lang: "fr" });
  });

  it("follows the system in system mode", () => {
    expect(run({ systemDark: true }).mode).toBe("dark");
    expect(run({ storage: { mode: "light" }, systemDark: true }).mode).toBe("light");
  });

  it("picks the browser language, then the cached instance language", () => {
    expect(run({ languages: ["fr-CA"] }).lang).toBe("fr");
    expect(run({ languages: ["de-DE"], storage: { instanceLanguage: "fr" } }).lang).toBe("fr");
  });

  it("ignores a theme left by the removed dev override", () => {
    expect(run({ storage: { devTheme: "dusk" } }).theme).toBe("default");
    expect(run({ storage: { devTheme: "dusk", instanceTheme: "default" } }).theme).toBe("default");
  });

  it("falls back to the default theme for a removed theme id", () => {
    expect(run({ storage: { instanceTheme: "night" } }).theme).toBe("default");
  });

  it("ignores unknown stored values", () => {
    expect(run({ storage: { instanceTheme: "neon", language: "de" } })).toEqual({ theme: "default", mode: "light", lang: "en" });
  });
});
