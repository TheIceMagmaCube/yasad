import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildIcons, excludedLicense, ICONS_BASE_FILE, NAMES_FILE, ROOT } from "../../../scripts/generate-icons.mjs";
import { LUCIDE, LUCIDE_ALIASES, SI } from "../../src/icons/names";
import { resolveIcon } from "../../src/icons/resolve";

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

/** Return the version of a package as the frontend resolves it. */
function installedVersion(name: string): string {
  return readJson(createRequire(join(ROOT, "frontend/package.json")).resolve(`${name}/package.json`)).version as string;
}

const generated = buildIcons();

describe("icon versions", () => {
  const devDependencies = readJson(join(ROOT, "package.json")).devDependencies as Record<string, string>;

  it("pins simple-icons and lucide-static exactly", () => {
    expect(devDependencies["simple-icons"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(devDependencies["lucide-static"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("uses the lucide-static version of the installed lucide-react, so catalog and interface icons match", () => {
    expect(devDependencies["lucide-static"]).toBe(installedVersion("lucide-react"));
    expect(generated.versions.lucide).toBe(installedVersion("lucide-react"));
  });
});

describe("generated icon lists", () => {
  it("are up to date: run node scripts/generate-icons.mjs and commit the result", () => {
    expect(readFileSync(NAMES_FILE, "utf8")).toBe(generated.names);
    expect(readFileSync(ICONS_BASE_FILE, "utf8")).toBe(generated.iconsBase);
  });

  it("name exactly the generated files", () => {
    const files = [...generated.files.keys()];
    expect(files.filter((f) => f.startsWith("si/")).sort()).toEqual([...SI].map((s) => `si/${s}.json`).sort());
    expect(files.filter((f) => f.startsWith("lucide/")).sort()).toEqual([...LUCIDE].map((s) => `lucide/${s}.json`).sort());
    expect(generated.iconsBase).toContain(`"/icons/${generated.hash}"`);
  });

  it("leave out every Simple Icon under a non-commercial, no-derivatives or custom licence", () => {
    const data = readJson(join(ROOT, "node_modules/simple-icons/data/simple-icons.json")) as unknown as { slug: string; license?: { type: string } }[];
    const excluded = data.filter((icon) => excludedLicense(icon.license));
    expect(excluded.length).toBeGreaterThan(0);
    for (const icon of excluded) {
      expect(SI.has(icon.slug)).toBe(false);
      expect(generated.files.has(`si/${icon.slug}.json`)).toBe(false);
    }
    expect(SI.size).toBe(data.length - excluded.length);
    expect(generated.files.get("NOTICE.txt")).not.toMatch(/CC-BY-(NC|ND)|: custom/);
  });

  it("map every Lucide alias to a canonical name, with no file of its own", () => {
    for (const [alias, name] of Object.entries(LUCIDE_ALIASES)) {
      expect(LUCIDE.has(alias)).toBe(false);
      expect(LUCIDE.has(name)).toBe(true);
      expect(generated.files.has(`lucide/${alias}.json`)).toBe(false);
    }
  });

  it("keep only the allowed Lucide tags and attributes", () => {
    const tags = new Set(["path", "circle", "rect", "line", "ellipse", "polyline", "polygon"]);
    const attributes = new Set(["d", "cx", "cy", "r", "x", "y", "width", "height", "rx", "ry", "x1", "x2", "y1", "y2", "points", "fill"]);
    for (const [path, content] of generated.files) {
      if (!path.startsWith("lucide/")) continue;
      for (const [tag, attrs] of (JSON.parse(content) as { nodes: [string, Record<string, string>][] }).nodes) {
        expect(tags.has(tag)).toBe(true);
        for (const key of Object.keys(attrs)) expect(attributes.has(key)).toBe(true);
      }
    }
  });
});

describe("generated icon files", () => {
  /** Cloudflare Workers static asset limits: files per deployment and bytes per file. */
  const MAX_ASSETS = 20_000;
  const MAX_FILE_BYTES = 25 * 1024 * 1024;
  /** Room left for the rest of frontend/dist (Vite chunks, fonts, public files). */
  const OTHER_ASSETS = 500;

  it("stay within the Workers static asset limits", () => {
    expect(generated.files.size + OTHER_ASSETS).toBeLessThan(MAX_ASSETS);
    const largest = Math.max(...[...generated.files.values()].map((content) => Buffer.byteLength(content)));
    expect(largest).toBeLessThan(MAX_FILE_BYTES);
  });
});

describe("resolveIcon", () => {
  it("returns known icons, the canonical name of an alias, and null otherwise", () => {
    expect(resolveIcon("si:github")).toEqual({ set: "si", name: "github" });
    expect(resolveIcon("si:backstage_casting")).toEqual({ set: "si", name: "backstage_casting" });
    expect(resolveIcon("lucide:mail")).toEqual({ set: "lucide", name: "mail" });
    expect(resolveIcon("lucide:activity-square")).toEqual({ set: "lucide", name: "square-activity" });
    for (const value of ["si:no_such_brand", "si:cocoapods", "lucide:toString", "lucide:constructor", "mail", "", null, undefined]) {
      expect(resolveIcon(value)).toBeNull();
    }
  });
});
