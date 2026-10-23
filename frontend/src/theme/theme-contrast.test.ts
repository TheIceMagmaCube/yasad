// Paths are relative to the frontend workspace, where Vitest runs.
import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it } from "vitest";

import { THEMES } from "../preferences";

type Rgb = [number, number, number];
type Mode = "light" | "dark";
type Tokens = Record<string, string>;

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

/** Return the custom properties declared in the block that starts with `selector`. */
function block(css: string, selector: string): Tokens {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`missing ${selector}`);
  const body = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]));
}

/**
 * Return the light block of a theme file, its dark block, and the tokens in effect in dark mode.
 *
 * Both selectors match <html> in dark mode, so a token the dark block leaves out keeps its light value.
 */
function parseTheme(css: string, theme: string) {
  const light = block(css, `[data-theme="${theme}"]`);
  const darkBlock = block(css, `[data-theme="${theme}"][data-mode="dark"]`);
  return { light, darkBlock, effective: { light, dark: { ...light, ...darkBlock } } as Record<Mode, Tokens> };
}

const themes: Record<string, ReturnType<typeof parseTheme>> = {};

beforeAll(async () => {
  for (const theme of THEMES) themes[theme] = parseTheme(await readFile(`src/theme/themes/${theme}.css`, "utf8"), theme);
});

/** Call `check` with a colour getter for every theme and mode, labelled for the failure message. */
function eachMode(check: (color: (token: string) => Rgb, label: string, tokens: Tokens) => void): void {
  for (const theme of THEMES) {
    for (const mode of ["light", "dark"] as const) {
      const tokens = themes[theme]!.effective[mode];
      const color = (token: string) => {
        const value = tokens[token];
        if (value === undefined) throw new Error(`${theme} ${mode} does not define --${token}`);
        return parseColor(value);
      };
      check(color, `${theme} ${mode}`, tokens);
    }
  }
}

/** Mode-independent tokens: the dark block may leave them to the light one. */
const SHARED = /^(radius|radius-card|font-.+|heading-weight|heading-tracking|caption-tracking)$/;

describe("theme contract", () => {
  it("defines the same tokens in every theme", () => {
    const expected = Object.keys(themes.default!.light).sort();
    for (const theme of THEMES) expect(Object.keys(themes[theme]!.light).sort(), theme).toEqual(expected);
  });

  it("redefines every colour, shadow and depth token for dark mode", () => {
    for (const theme of THEMES) {
      const { light, darkBlock } = themes[theme]!;
      const missing = Object.keys(light).filter((token) => !SHARED.test(token) && !(token in darkBlock));
      expect(missing, theme).toEqual([]);
      expect(Object.keys(darkBlock).filter((token) => !(token in light)), theme).toEqual([]);
    }
  });

  it("defines every token the stylesheet reads", async () => {
    const css = await readFile("src/index.css", "utf8");
    const read = new Set([...css.matchAll(/var\(--([\w-]+)[,)]/g)].map((match) => match[1]!));
    // Set per element by the relief and Tailwind utilities, not by a theme.
    const local = /^(tw-.+|relief-(y|shade|base|color|ring|inset))$/;
    const missing = [...read].filter((token) => !local.test(token) && !(token in themes.default!.light));
    expect(missing).toEqual([]);
  });
});

// Text needs 4.5:1 (WCAG 1.4.3). A control boundary, a focus indicator, a state marker or an icon needs 3:1
// against what touches it (WCAG 1.4.11, 2.4.13). axe checks text it renders but not these.

describe("muted text", () => {
  // Secondary text (descriptions, the status line of a link card) and the unknown status icon use it.
  it("keeps 4.5:1 for muted-foreground on the page and on a card", () => {
    eachMode((color, label) => {
      for (const ground of ["background", "card"]) {
        expect(contrast(color("muted-foreground"), color(ground)), `${label} muted-foreground on ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  });
});

describe("category colours", () => {
  // A link's icon tile is a solid category fill with its icon or initial in on-fill: the 4.5:1 below covers the 3:1
  // the icon needs as a graphic (WCAG 1.4.11).
  it("keep 4.5:1 between on-fill text and each solid category fill", async () => {
    // The pair only covers the tile while the tile draws it.
    const tones = await readFile("src/lib/category-tone.ts", "utf8");
    for (let n = 1; n <= 6; n++) expect(tones, `category-${n}`).toContain(`tile: "bg-category-${n}-fill text-on-fill"`);
    eachMode((color, label) => {
      for (let n = 1; n <= 6; n++) {
        expect(contrast(color("on-fill"), color(`category-${n}-fill`)), `${label} category-${n}-fill`).toBeGreaterThanOrEqual(4.5);
      }
    });
  });
});

describe("status colours", () => {
  const STATUSES = ["success", "warning", "info", "destructive"] as const;

  it("keep 3:1 for the icon and border against the page, a card and their own surface", () => {
    eachMode((color, label) => {
      for (const status of STATUSES) {
        for (const ground of ["background", "card", `${status}-surface`]) {
          expect(contrast(color(status), color(ground)), `${label} ${status} on ${ground}`).toBeGreaterThanOrEqual(3);
        }
      }
    });
  });

  it("keep 4.5:1 for the foreground text on each surface and for the solid status label", () => {
    eachMode((color, label) => {
      for (const status of STATUSES) {
        expect(contrast(color("foreground"), color(`${status}-surface`)), `${label} text on ${status}-surface`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(color(`${status}-foreground`), color(status)), `${label} ${status}-foreground`).toBeGreaterThanOrEqual(4.5);
      }
    });
  });

  it("keep 4.5:1 for the error colour used as text (field errors, destructive-ghost buttons)", () => {
    eachMode((color, label) => {
      for (const ground of ["background", "card", "destructive-surface"]) {
        expect(contrast(color("destructive"), color(ground)), `${label} destructive on ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  });
});

describe("focus indicator", () => {
  it("keeps 3:1 between the ring and every surface a focusable element sits on", () => {
    eachMode((color, label) => {
      for (const ground of ["background", "card", "popover", "accent", "muted"]) {
        expect(contrast(color("ring"), color(ground)), `${label} ring on ${ground}`).toBeGreaterThanOrEqual(3);
      }
      // Header controls draw their ring in header-foreground.
      expect(contrast(color("header-foreground"), color("header")), `${label} header ring`).toBeGreaterThanOrEqual(3);
    });
  });
});

describe("selected-state marker", () => {
  it("keeps 3:1 against the page, a card and the selected item's accent fill", () => {
    eachMode((color, label) => {
      for (const ground of ["background", "card", "accent"]) {
        expect(contrast(color("selected"), color(ground)), `${label} selected on ${ground}`).toBeGreaterThanOrEqual(3);
      }
      // The header's current page is underlined in header-active.
      expect(contrast(color("header-active"), color("header")), `${label} header-active`).toBeGreaterThanOrEqual(3);
      // A highlighted search result or menu item gets the ring on the accent fill.
      expect(contrast(color("ring"), color("accent")), `${label} ring on accent`).toBeGreaterThanOrEqual(3);
    });
  });
});

describe("control boundaries", () => {
  it("keep 3:1 for field borders and outlined controls against the page, a card and a popover", () => {
    eachMode((color, label) => {
      for (const edge of ["input", "control-ring"]) {
        for (const ground of ["background", "card", "popover"]) {
          expect(contrast(color(edge), color(ground)), `${label} ${edge} on ${ground}`).toBeGreaterThanOrEqual(3);
        }
      }
    });
  });

  it("keep 3:1 for a primary control: its fill, or else its ring, stands out from the page and a card", async () => {
    // The ring only counts if the primary button draws it.
    expect(await readFile("src/components/ui/button.tsx", "utf8")).toContain("var(--control-primary-ring)");
    eachMode((color, label, tokens) => {
      for (const ground of ["background", "card"]) {
        const fill = contrast(color("primary"), color(ground));
        const ring = tokens["control-primary-ring"] === "transparent" ? 0 : contrast(color("control-primary-ring"), color(ground));
        expect(Math.max(fill, ring), `${label} primary on ${ground}`).toBeGreaterThanOrEqual(3);
      }
    });
  });
});

describe("header search field", () => {
  it("keeps 3:1 for its border and 4.5:1 for its placeholder and shortcut text against the header", () => {
    eachMode((color, label) => {
      // The border is drawn in header-muted too, so its 4.5:1 covers the border's 3:1.
      expect(contrast(color("header-muted"), color("header")), label).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color("header-foreground"), color("header")), label).toBeGreaterThanOrEqual(4.5);
    });
  });
});
