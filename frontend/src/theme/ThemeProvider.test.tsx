import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hexColor, ThemeProvider } from "./ThemeProvider";

// jsdom paints nothing: this canvas gives back the sRGB value a browser would paint for each colour of the sheet,
// and like a browser it ignores a colour it cannot parse, keeping the previous one.
const PAINTED: Record<string, [number, number, number]> = {
  "#0e0d14": [0x0e, 0x0d, 0x14],
  "#f4efe2": [0xf4, 0xef, 0xe2],
  "oklch(0.22 0.04 285)": [0x1b, 0x18, 0x2c],
};

let style: HTMLStyleElement;

beforeEach(() => {
  style = document.createElement("style");
  style.textContent = `
    [data-theme="default"][data-mode="light"] { --header: #f4efe2; }
    [data-theme="default"][data-mode="dark"] { --header: #0e0d14; }
    [data-theme="dusk"] { --header: oklch(0.22 0.04 285); }`;
  document.head.append(style);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function () {
    let fill = "#000000";
    return {
      get fillStyle() {
        return fill;
      },
      set fillStyle(value: string) {
        if (value in PAINTED || /^#[0-9a-f]{6}$/.test(value)) fill = value;
      },
      fillRect: () => undefined,
      getImageData: () => ({ data: Uint8ClampedArray.from([...(PAINTED[fill] ?? [0, 0, 0]), 255]) }),
    } as unknown as CanvasRenderingContext2D;
  } as never);
});

afterEach(() => {
  style.remove();
  document.querySelector('meta[name="theme-color"]')?.remove();
  vi.restoreAllMocks();
});

const themeColor = () => document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content;

describe("ThemeProvider: theme-color", () => {
  it("follows the theme and the mode, as #rrggbb even for a theme written in oklch", () => {
    localStorage.setItem("yasad.mode", "light");
    const { rerender, unmount } = render(<ThemeProvider instanceTheme="default">x</ThemeProvider>);
    expect(themeColor()).toBe("#f4efe2");
    rerender(<ThemeProvider instanceTheme="dusk">x</ThemeProvider>);
    expect(themeColor()).toBe("#1b182c");
    unmount();
    localStorage.setItem("yasad.mode", "dark");
    render(<ThemeProvider instanceTheme="default">x</ThemeProvider>);
    expect(themeColor()).toBe("#0e0d14");
    expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
  });
});

describe("hexColor", () => {
  it("gives #rrggbb for a colour the canvas reads, and null for one it ignores", () => {
    expect(hexColor("oklch(0.22 0.04 285)")).toBe("#1b182c");
    expect(hexColor("#0e0d14")).toBe("#0e0d14");
    expect(hexColor("not-a-colour")).toBeNull();
    expect(hexColor("")).toBeNull();
  });

  it("leaves theme-color unset when the header colour cannot be read", () => {
    style.textContent = `[data-theme="default"] { --header: not-a-colour; }`;
    render(<ThemeProvider instanceTheme="default">x</ThemeProvider>);
    expect(themeColor()).toBeUndefined();
  });
});
