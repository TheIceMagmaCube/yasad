import { describe, expect, it } from "vitest";

import { sanitizeSvg, safeCssValue } from "../../src/images/svg";
import { MALICIOUS_SVGS, nestedUses, svg } from "../harness/images";

const run = (source: string) => sanitizeSvg(new TextEncoder().encode(source));
const output = (source: string) => {
  const result = run(source);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return { ...result, text: new TextDecoder().decode(result.bytes) };
};

describe("sanitizeSvg: malicious files", () => {
  for (const { name, svg: source, absent, refused } of MALICIOUS_SVGS) {
    it(name, () => {
      const result = run(source);
      if (refused) {
        expect(result).toEqual({ ok: false, reason: refused });
        return;
      }
      const { text, sanitized } = output(source);
      for (const fragment of absent!) expect(text).not.toContain(fragment);
      expect(sanitized).toBe(true);
    });
  }

  it("refuses use elements aiming at an element that holds a use, even few of them", () => {
    expect(run(nestedUses(2))).toEqual({ ok: false, reason: "svg_too_complex" });
    expect(run(svg('<g id="a"><use href="#a"/></g>'))).toEqual({ ok: false, reason: "svg_too_complex" });
  });

  it("checks every element carrying a duplicated id, and refuses a use whose target is missing or encoded", () => {
    expect(run(svg('<path id="b" d="M0 0"/><g id="a"><use href="#b"/></g><rect id="a"/><use href="#a"/>'))).toEqual({ ok: false, reason: "svg_too_complex" });
    expect(run(svg('<path id="b" d="M0 0"/><g id="a"><use href="#b"/></g><use href="#%61"/>'))).toEqual({ ok: false, reason: "svg_too_complex" });
    // An id written with the escape itself does not make the reference safe: the browser decodes it to `a`.
    expect(run(svg('<path id="b" d="M0 0"/><path id="%61" d="M0 0"/><g id="a"><use href="#b"/></g><use href="#%61"/>'))).toEqual({ ok: false, reason: "svg_too_complex" });
    expect(run(svg('<path id="p" d="M0 0"/><use href="#q"/>'))).toEqual({ ok: false, reason: "svg_too_complex" });
    expect(run(svg('<path id="p" d="M0 0"/><use href="#p" xlink:href="#q"/>'))).toEqual({ ok: false, reason: "svg_too_complex" });
    expect(run(svg('<rect id="p"/><path id="p" d="M0 0"/><use href="#p"/><use/>')).ok).toBe(true);
  });

  it("refuses more than 100 use elements", () => {
    const uses = Array.from({ length: 101 }, () => '<use href="#p"/>').join("");
    expect(run(svg(`<path id="p" d="M0 0"/>${uses}`))).toEqual({ ok: false, reason: "svg_too_complex" });
    expect(run(svg(`<path id="p" d="M0 0"/>${uses.slice('<use href="#p"/>'.length)}`)).ok).toBe(true);
  });

  it("refuses more than 5000 elements or 64 levels", () => {
    expect(run(svg("<g/>".repeat(5000)))).toEqual({ ok: false, reason: "svg_too_complex" });
    expect(run(svg("<g/>".repeat(4999))).ok).toBe(true);
    expect(run(svg(`${"<g>".repeat(64)}${"</g>".repeat(64)}`))).toEqual({ ok: false, reason: "svg_too_complex" });
    expect(run(svg(`${"<g>".repeat(63)}${"</g>".repeat(63)}`)).ok).toBe(true);
  });

  it("refuses a root other than svg, and a file that is not UTF-8", () => {
    expect(run('<html><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/></html>')).toEqual({ ok: false, reason: "unsupported_type" });
    expect(run('<svg:svg xmlns:svg="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>')).toEqual({ ok: false, reason: "unsupported_type" });
    expect(sanitizeSvg(Uint8Array.from([0x3c, 0x73, 0x76, 0x67, 0xff]))).toEqual({ ok: false, reason: "unsupported_type" });
  });

  it("refuses a drawing without a readable size", () => {
    expect(run('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')).toEqual({ ok: false, reason: "unreadable" });
    expect(run(svg("", 'width="10%" height="20%"'))).toEqual({ ok: false, reason: "unreadable" });
  });
});

describe("sanitizeSvg: what is kept", () => {
  it("keeps the viewBox, gradients, paths, text and allowed style, and reports no removal", () => {
    const source = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generator: an editor -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" viewBox="0 0 120 60" xml:space="preserve">
<style type="text/css"><![CDATA[ .st0 { fill: url(#grad); stroke: #333 } path.a > rect, #b { fill-opacity: .5 } ]]></style>
<defs><linearGradient id="grad" x1="0" y1="0" x2="1" y2="1" gradientTransform="rotate(45)"><stop offset="0" stop-color="rgb(10, 20, 30)"/><stop offset="1" style="stop-color:hsl(120, 50%, 50%)"/></linearGradient>
<symbol id="s"><circle cx="5" cy="5" r="4"/></symbol></defs>
<path class="st0" d="M0 0h10v10z" transform="translate(5 5) scale(2)"/>
<use xlink:href="#s"/><use href="#s"/>
<text x="1" y="50" font-family="sans-serif">A &amp; B &lt; C</text>
</svg>`;
    const { text, sanitized, width, height } = output(source);
    expect(sanitized).toBe(false);
    expect({ width, height }).toEqual({ width: 120, height: 60 });
    expect(text).toContain('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 120 60">');
    expect(text).toContain(".st0{fill:url(#grad);stroke:#333}path.a&gt;rect,#b{fill-opacity:.5}");
    expect(text).toContain('<linearGradient id="grad" x1="0" y1="0" x2="1" y2="1" gradientTransform="rotate(45)">');
    expect(text).toContain('<stop offset="0" stop-color="rgb(10, 20, 30)"/>');
    expect(text).toContain('style="stop-color:hsl(120, 50%, 50%)"');
    expect(text).toContain('<path class="st0" d="M0 0h10v10z" transform="translate(5 5) scale(2)"/>');
    expect(text).toContain('<use xlink:href="#s"/><use href="#s"/>');
    expect(text).toContain("A &amp; B &lt; C</text>");
    expect(text).not.toContain("Generator");
  });

  it("reads the size from width and height when there is no viewBox", () => {
    expect(output(svg("", 'width="32px" height="16.4"'))).toMatchObject({ width: 32, height: 16 });
  });

  it("keeps an image whose rewrite parses back to the same file", () => {
    const first = output(svg('<path fill="url(#a)" d="M0 0"/><text>x &gt; y</text>')).text;
    expect(output(first).text).toBe(first);
  });
});

describe("safeCssValue", () => {
  it("accepts colours, lengths and local references", () => {
    for (const value of ["red", "#fff", "rgb(1,2,3)", "rgba(1, 2, 3, .5)", "hsl(1 2% 3%)", "url(#a)", "1px 2px", "none !important"]) {
      expect(safeCssValue(value), value).toBe(true);
    }
  });

  it("refuses quotes, escapes and any other function", () => {
    for (const value of ['url("#a")', "url(https://x)", "u\\rl(x)", "image-set(x 1x)", "var(--a)", "expression(alert(1))", "(1)", "calc(1px)", "a;b", "red\u0000", ""]) {
      expect(safeCssValue(value), value).toBe(false);
    }
  });
});
