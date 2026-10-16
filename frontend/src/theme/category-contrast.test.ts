// Paths are relative to the frontend workspace, where Vitest runs.
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { THEMES } from "../preferences";

type Rgb = [number, number, number];

/** Return the gamma-encoded sRGB channels (0 to 1) of a hex or oklch() colour, clipped to the sRGB gamut. */
function parseColor(value: string): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16) / 255) as Rgb;
  const oklch = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value);
  if (!oklch) throw new Error(`unsupported colour: ${value}`);
  const [L, C, h] = oklch.slice(1).map(Number) as [number, number, number];
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return linear.map((x) => {
    const c = Math.min(1, Math.max(0, x));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  }) as Rgb;
}

/** Return the WCAG relative luminance of a gamma-encoded sRGB colour. */
function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Return the custom properties of the light and dark blocks of a theme file. */
function themeTokens(css: string, theme: string): Record<"light" | "dark", Record<string, string>> {
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    if (start < 0) throw new Error(`missing ${selector}`);
    const body = css.slice(start, css.indexOf("}", start));
    return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]));
  };
  return { light: block(`[data-theme="${theme}"]`), dark: block(`[data-theme="${theme}"][data-mode="dark"]`) };
}

describe("category colours", () => {
  // The tile is bg-category-N/12 on a card, the letter or icon is text-category-N. The letter is 24 px (large text)
  // and the icon a graphic: both need 3:1 (WCAG 1.4.3 large text, 1.4.11).
  it.each(THEMES)("keep 3:1 between the icon or letter and its tile in the %s theme", async (theme) => {
    const tokens = themeTokens(await readFile(`src/theme/themes/${theme}.css`, "utf8"), theme);
    for (const mode of ["light", "dark"] as const) {
      const card = parseColor(tokens[mode].card!);
      for (let n = 1; n <= 6; n++) {
        const color = parseColor(tokens[mode][`category-${n}`]!);
        const tile = color.map((c, i) => 0.12 * c + 0.88 * card[i]!) as Rgb;
        expect(contrast(color, tile), `${theme} ${mode} category-${n}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
