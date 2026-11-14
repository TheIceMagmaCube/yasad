// An SVG is rebuilt from an allow-list, never cleaned in place: only the elements, attributes and CSS rules
// listed here are copied, then written out by our own serializer. Values are checked after the parser has
// decoded their entities, and written back escaped.

import { Parser } from "htmlparser2";

import { MAX_SVG_DEPTH, MAX_SVG_ELEMENTS, MAX_SVG_USES } from "./limits";
import type { InvalidReason } from "./sniff";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

const ELEMENTS = new Set([
  "svg", "g", "path", "circle", "ellipse", "line", "polyline", "polygon", "rect", "defs", "symbol", "use",
  "linearGradient", "radialGradient", "stop", "clipPath", "mask", "pattern", "text", "tspan", "title", "desc", "style",
]);
/** Elements whose text is drawn or read; text anywhere else is not copied. */
const TEXT_ELEMENTS = new Set(["text", "tspan", "title", "desc"]);

/** CSS properties that are also SVG presentation attributes: the only ones kept, as attributes or in CSS. */
const PRESENTATION = new Set([
  "alignment-baseline", "baseline-shift", "clip-path", "clip-rule", "color", "color-interpolation", "color-rendering",
  "direction", "display", "dominant-baseline", "enable-background", "fill", "fill-opacity", "fill-rule", "font-family",
  "font-size", "font-size-adjust", "font-stretch", "font-style", "font-variant", "font-weight", "isolation",
  "letter-spacing", "marker-end", "marker-mid", "marker-start", "mask", "mix-blend-mode", "opacity", "overflow",
  "paint-order", "shape-rendering", "stop-color", "stop-opacity", "stroke", "stroke-dasharray", "stroke-dashoffset",
  "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-opacity", "stroke-width", "text-anchor",
  "text-decoration", "text-rendering", "transform-origin", "unicode-bidi", "vector-effect", "visibility",
  "word-spacing", "writing-mode",
]);
/** Geometry and structure attributes; their values never hold a function. */
const GEOMETRY = new Set([
  "id", "class", "viewBox", "preserveAspectRatio", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
  "fx", "fy", "fr", "width", "height", "d", "points", "pathLength", "offset", "gradientUnits", "spreadMethod",
  "patternUnits", "patternContentUnits", "clipPathUnits", "maskUnits", "maskContentUnits", "dx", "dy", "rotate",
  "textLength", "lengthAdjust", "refX", "refY",
]);
const TRANSFORMS = new Set(["transform", "gradientTransform", "patternTransform"]);
const TRANSFORM_FUNCTIONS = new Set(["matrix", "translate", "scale", "rotate", "skewX", "skewY"]);
/** Rewritten by the serializer or meaningless once rebuilt: dropped without counting as a removal. */
const REWRITTEN = new Set(["xmlns", "version", "baseProfile", "xml:space"]);
const COLOR_FUNCTIONS = new Set(["rgb", "rgba", "hsl", "hsla"]);

type Cdata = { cdata: string };
type Element = { name: string; attribs: Record<string, string>; children: (Element | string | Cdata)[] };

export type SvgResult =
  | { ok: true; bytes: Uint8Array<ArrayBuffer>; width: number; height: number; sanitized: boolean }
  | { ok: false; reason: InvalidReason };

class TooComplex extends Error {}

function parse(text: string): { roots: Element[]; dropped: boolean } {
  const top: Element = { name: "", attribs: {}, children: [] };
  const stack = [top];
  let count = 0;
  let inCdata = false;
  let dropped = false;
  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (++count > MAX_SVG_ELEMENTS || stack.length > MAX_SVG_DEPTH) throw new TooComplex();
        const element: Element = { name, attribs, children: [] };
        stack.at(-1)!.children.push(element);
        stack.push(element);
      },
      onclosetag() {
        if (stack.length > 1) stack.pop();
      },
      ontext(data) {
        stack.at(-1)!.children.push(inCdata ? { cdata: data } : data);
      },
      oncdatastart() {
        inCdata = true;
      },
      oncdataend() {
        inCdata = false;
      },
      onprocessinginstruction(name) {
        // The XML declaration is the usual prologue; any other instruction (xml-stylesheet...) is a removal.
        if (name.toLowerCase() !== "?xml") dropped = true;
      },
    },
    { xmlMode: true },
  );
  parser.write(text);
  parser.end();
  return { roots: top.children.filter((c): c is Element => typeof c === "object" && "name" in c), dropped };
}

/** Return whether a CSS value is safe: no quote, no escape, no function but colours and `url(#id)`. */
export function safeCssValue(value: string): boolean {
  if (value === "" || /["'\\<>{};@]/.test(value) || /[^\P{Cc}\t\n\f\r]/u.test(value)) return false;
  for (const match of value.matchAll(/([A-Za-z-]*)\(/g)) {
    const name = match[1]!.toLowerCase();
    if (name === "url") {
      if (!/^url\(#[\w.:-]+\)/i.test(value.slice(match.index))) return false;
    } else if (!COLOR_FUNCTIONS.has(name)) return false;
  }
  return true;
}

function safeTransform(value: string): boolean {
  if (!/^[\sA-Za-z0-9.,+\-()]*$/.test(value)) return false;
  return [...value.matchAll(/([A-Za-z]*)\s*\(/g)].every((m) => TRANSFORM_FUNCTIONS.has(m[1]!));
}

type Context = { dropped: boolean };

/** Return the declarations of a `style` attribute or a CSS rule that pass the allow-list, `;`-separated. */
function declarations(body: string, ctx: Context): string {
  const kept: string[] = [];
  for (const declaration of body.split(";")) {
    if (declaration.trim() === "") continue;
    const colon = declaration.indexOf(":");
    const property = colon < 0 ? "" : declaration.slice(0, colon).trim().toLowerCase();
    const value = colon < 0 ? "" : declaration.slice(colon + 1).trim();
    if (PRESENTATION.has(property) && safeCssValue(value)) kept.push(`${property}:${value}`);
    else ctx.dropped = true;
  }
  return kept.join(";");
}

const SIMPLE_SELECTOR = /^(?:[A-Za-z][\w-]*)?(?:[.#][A-Za-z_][\w-]*)*$/;

/** Return the selector normalized when made only of element names, classes and ids, else null. */
function safeSelector(selector: string): string | null {
  const parts: string[] = [];
  for (const part of selector.split(",")) {
    const compounds = part.trim().split(/\s*>\s*|\s+/);
    if (compounds.some((c) => c === "" || !SIMPLE_SELECTOR.test(c))) return null;
    parts.push(part.trim().replace(/\s*>\s*/g, ">").replace(/\s+/g, " "));
  }
  return parts.join(",");
}

/** Return the index of the brace closing the block opened at `open`, or the end of the text. */
function blockEnd(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return i;
  }
  return css.length;
}

/** Return the rules of a style sheet that pass the allow-list; every at-rule is dropped. */
function stylesheet(source: string, ctx: Context): string {
  let css = source.replace(/\/\*[\s\S]*?\*\//g, " ");
  const unclosed = css.indexOf("/*");
  if (unclosed >= 0) {
    css = css.slice(0, unclosed);
    ctx.dropped = true;
  }
  const rules: string[] = [];
  let i = 0;
  while (i < css.length) {
    while (i < css.length && /\s/.test(css[i]!)) i++;
    if (i >= css.length) break;
    const open = css.indexOf("{", i);
    if (css[i] === "@") {
      ctx.dropped = true;
      const semicolon = css.indexOf(";", i);
      i = open >= 0 && (semicolon < 0 || open < semicolon) ? blockEnd(css, open) + 1 : semicolon < 0 ? css.length : semicolon + 1;
      continue;
    }
    if (open < 0) {
      ctx.dropped = true;
      break;
    }
    const end = blockEnd(css, open);
    const body = css.slice(open + 1, end);
    const selector = safeSelector(css.slice(i, open));
    i = end + 1;
    if (selector === null || body.includes("{")) {
      ctx.dropped = true;
      continue;
    }
    const kept = declarations(body, ctx);
    if (kept) rules.push(`${selector}{${kept}}`);
  }
  return rules.join("");
}

/** Return the attribute's value to keep, or null to drop it. */
function attributeValue(name: string, value: string, ctx: Context): string | null {
  if (name === "style") return declarations(value, ctx) || null;
  if (name === "href" || name === "xlink:href") return value.trim().startsWith("#") ? value.trim() : null;
  if (PRESENTATION.has(name)) return safeCssValue(value.trim()) ? value : null;
  if (TRANSFORMS.has(name)) return safeTransform(value) ? value : null;
  if (GEOMETRY.has(name)) return value.includes("(") ? null : value;
  return null;
}

function rewrite(source: Element, ctx: Context): Element | null {
  if (!ELEMENTS.has(source.name)) {
    ctx.dropped = true;
    return null;
  }
  const attribs: Record<string, string> = {};
  for (const [name, value] of Object.entries(source.attribs)) {
    if (REWRITTEN.has(name) || name.startsWith("xmlns:") || (source.name === "style" && name === "type")) continue;
    const kept = attributeValue(name, value, ctx);
    if (kept === null) ctx.dropped = true;
    else attribs[name] = kept;
  }
  const element: Element = { name: source.name, attribs, children: [] };
  if (source.name === "style") {
    const css = stylesheet(source.children.map((c) => (typeof c === "string" ? c : "cdata" in c ? c.cdata : "")).join(""), ctx);
    if (source.children.some((c) => typeof c === "object" && "name" in c)) ctx.dropped = true;
    if (css) element.children.push(css);
    return element;
  }
  for (const child of source.children) {
    if (typeof child === "string") {
      if (TEXT_ELEMENTS.has(source.name)) element.children.push(child);
    } else if ("cdata" in child) {
      if (child.cdata.trim()) ctx.dropped = true;
    } else {
      const kept = rewrite(child, ctx);
      if (kept) element.children.push(kept);
    }
  }
  return element;
}

const elementsOf = function* (element: Element): Generator<Element> {
  yield element;
  for (const child of element.children) if (typeof child === "object" && "name" in child) yield* elementsOf(child);
};

/**
 * Return whether the `<use>` elements stay bounded: at most {@link MAX_SVG_USES}, each aiming at an element that
 * exists and holds no `<use>` itself. Nested copies multiply the drawing and would freeze the tab of everyone
 * shown the icon.
 *
 * Every element carrying the id is checked, since browsers take the first one and a Map would keep the last. A
 * reference must name an id as written: browsers percent-decode it before the lookup, so `#%61` reaches `id="a"`.
 */
function usesBounded(root: Element): boolean {
  const all = [...elementsOf(root)];
  const uses = all.filter((e) => e.name === "use");
  if (uses.length > MAX_SVG_USES) return false;
  const byId = new Map<string, Element[]>();
  for (const e of all) if (e.attribs.id !== undefined) byId.set(e.attribs.id, [...(byId.get(e.attribs.id) ?? []), e]);
  return uses.every((use) =>
    [use.attribs.href, use.attribs["xlink:href"]].every((href) => {
      if (href === undefined) return true;
      const targets = href.includes("%") ? undefined : byId.get(href.slice(1));
      return targets !== undefined && targets.every((target) => ![...elementsOf(target)].some((e) => e.name === "use"));
    }),
  );
}

/** Return the drawing's size from `viewBox`, else from `width` and `height` in user units, or null. */
function sizeOf(root: Element): { width: number; height: number } | null {
  const box = root.attribs.viewBox?.trim().split(/[\s,]+/).map(Number);
  const [width, height] =
    box?.length === 4 ? [box[2]!, box[3]!] : [root.attribs.width, root.attribs.height].map((v) => (v !== undefined && /^\s*[\d.]+(px)?\s*$/.test(v) ? parseFloat(v) : NaN));
  const valid = (n: number | undefined): n is number => n !== undefined && Number.isFinite(n) && n > 0 && n <= 1_000_000;
  return valid(width) && valid(height) ? { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) } : null;
}

const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttribute = (text: string) => escapeText(text).replace(/"/g, "&quot;");

function serialize(element: Element, out: string[], root: boolean, xlink: boolean): void {
  out.push("<", element.name);
  if (root) out.push(` xmlns="${SVG_NS}"`, xlink ? ` xmlns:xlink="${XLINK_NS}"` : "");
  for (const [name, value] of Object.entries(element.attribs)) out.push(" ", name, '="', escapeAttribute(value), '"');
  if (element.children.length === 0) {
    out.push("/>");
    return;
  }
  out.push(">");
  for (const child of element.children) {
    if (typeof child === "string") out.push(escapeText(child));
    else if ("name" in child) serialize(child, out, false, xlink);
  }
  out.push("</", element.name, ">");
}

/**
 * Return the SVG rebuilt from the allow-list, with its size, or why it is refused.
 *
 * `sanitized` is true when an element, an attribute, a CSS rule or declaration, a CDATA section outside `<style>`
 * or a processing instruction was removed; comments, namespace declarations and the XML declaration are dropped
 * without counting, since the serializer rewrites them.
 */
export function sanitizeSvg(bytes: Uint8Array): SvgResult {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: "unsupported_type" };
  }
  // External entities and entity expansion are refused before any parsing.
  if (/<!(DOCTYPE|ENTITY)/i.test(text)) return { ok: false, reason: "svg_doctype" };
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(text);
  } catch (error) {
    if (error instanceof TooComplex) return { ok: false, reason: "svg_too_complex" };
    throw error;
  }
  if (parsed.roots.length !== 1 || parsed.roots[0]!.name !== "svg") return { ok: false, reason: "unsupported_type" };
  const ctx: Context = { dropped: parsed.dropped };
  const root = rewrite(parsed.roots[0]!, ctx)!;
  if (!usesBounded(root)) return { ok: false, reason: "svg_too_complex" };
  const size = sizeOf(root);
  if (!size) return { ok: false, reason: "unreadable" };
  const xlink = [...elementsOf(root)].some((e) => e.attribs["xlink:href"] !== undefined);
  const out: string[] = [];
  serialize(root, out, true, xlink);
  return { ok: true, bytes: new TextEncoder().encode(out.join("")), ...size, sanitized: ctx.dropped };
}
