// Image files built byte by byte, for the unit tests and the API tests on both targets (no Node API here).

const text = (s: string) => new TextEncoder().encode(s);

export function concat(...parts: (Uint8Array | number[])[]): Uint8Array<ArrayBuffer> {
  const arrays = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of arrays) {
    out.set(a, at);
    at += a.length;
  }
  return out;
}

const u32be = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16be = (n: number) => [(n >>> 8) & 0xff, n & 0xff];
const u32le = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const u24le = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];
const u16le = (n: number) => [n & 0xff, (n >>> 8) & 0xff];

/** Return whether `haystack` contains the bytes of `needle`. */
export function includes(haystack: Uint8Array, needle: string | Uint8Array): boolean {
  const n = typeof needle === "string" ? text(needle) : needle;
  outer: for (let i = 0; i + n.length <= haystack.length; i++) {
    for (let j = 0; j < n.length; j++) if (haystack[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// PNG

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function pngChunk(type: string, data: Uint8Array | number[] = []): Uint8Array {
  const body = concat(text(type), data);
  return concat(u32be(body.length - 4), body, u32be(crc32(body)));
}

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A PNG of the given size; `before` chunks go between IHDR and IDAT, `after` between IDAT and IEND. */
export function png({ width = 16, height = 16, before = [] as Uint8Array[], after = [] as Uint8Array[], padding = 0 } = {}) {
  return concat(
    PNG_SIGNATURE,
    pngChunk("IHDR", [...u32be(width), ...u32be(height), 8, 6, 0, 0, 0]),
    ...before,
    pngChunk("IDAT", [0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, ...new Array<number>(padding).fill(0)]),
    ...after,
    pngChunk("IEND"),
  );
}

export const apng = () => png({ before: [pngChunk("acTL", [...u32be(2), ...u32be(0)])] });
export const iccp = () => pngChunk("iCCP", [...text("icc"), 0, 0, 0x78, 0x9c, 1, 2, 3]);

// JPEG

const segment = (marker: number, data: Uint8Array | number[]) => {
  const body = data instanceof Uint8Array ? data : Uint8Array.from(data);
  return concat([0xff, marker, ...u16be(body.length + 2)], body);
};

export const jpegExif = () => segment(0xe1, concat(text("Exif\0\0"), text("GPSLatitude 48.8566 N Canon EOS author Jane")));
export const jpegXmp = () => segment(0xe1, text("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>secret</x:xmpmeta>"));
export const jpegIptc = () => segment(0xed, text("Photoshop 3.0\0IPTC by Jane"));
export const jpegComment = () => segment(0xfe, text("taken at home"));
export const jpegIcc = () => segment(0xe2, text("ICC_PROFILE\0\x01\x01profile-bytes"));

/** A JPEG with one scan (or two when progressive), its entropy data holding a stuffed 0xFF and a restart marker. */
export function jpeg({ width = 16, height = 16, progressive = false, extra = [] as Uint8Array[], trailing = [] as number[] } = {}) {
  const sof = segment(progressive ? 0xc2 : 0xc0, [8, ...u16be(height), ...u16be(width), 1, 1, 0x11, 0]);
  const dht = segment(0xc4, [0x00, 1, ...new Array<number>(15).fill(0), 0]);
  const sos = segment(0xda, [1, 1, 0, 0, 0x3f, 0]);
  const scan = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56];
  return concat(
    [0xff, 0xd8],
    segment(0xe0, [...text("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...extra,
    segment(0xdb, [0, ...new Array<number>(64).fill(1)]),
    sof,
    dht,
    sos,
    scan,
    ...(progressive ? [dht, sos, scan] : []),
    [0xff, 0xd9],
    trailing,
  );
}

// WebP

export function riffChunk(type: string, data: Uint8Array | number[]): Uint8Array {
  const body = data instanceof Uint8Array ? data : Uint8Array.from(data);
  return concat(text(type), u32le(body.length), body, body.length % 2 ? [0] : []);
}

const riff = (...chunks: Uint8Array[]) => {
  const body = concat(text("WEBP"), ...chunks);
  return concat(text("RIFF"), u32le(body.length), body);
};

export const vp8 = (width = 16, height = 16) =>
  riffChunk("VP8 ", [0x50, 0x01, 0x00, 0x9d, 0x01, 0x2a, ...u16le(width), ...u16le(height), 0, 0, 0, 0]);
export const vp8l = (width = 16, height = 16) => {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  return riffChunk("VP8L", [0x2f, ...u32le(bits >>> 0), 0, 0]);
};

/** VP8X flags. */
export const WEBP_FLAGS = { icc: 0x20, alpha: 0x10, exif: 0x08, xmp: 0x04, animation: 0x02 };

export const webpLossy = (width = 16, height = 16) => riff(vp8(width, height));
export const webpLossless = (width = 16, height = 16) => riff(vp8l(width, height));

/** An extended WebP: VP8X, then `chunks` (ICCP, EXIF, XMP...) and a lossy bitstream. */
export function webpExtended({ width = 16, height = 16, flags = 0, chunks = [] as Uint8Array[], bitstream = vp8(width, height) } = {}) {
  return riff(riffChunk("VP8X", [flags, 0, 0, 0, ...u24le(width - 1), ...u24le(height - 1)]), ...chunks, bitstream);
}

export const webpExif = () => riffChunk("EXIF", text("Exif\0\0GPSLatitude 48.8566"));
export const webpXmp = () => riffChunk("XMP ", text("<x:xmpmeta>secret author</x:xmpmeta>"));
export const webpIcc = () => riffChunk("ICCP", text("icc-profile"));

/** The VP8X flags byte and the RIFF size of a WebP. */
export const webpHeader = (b: Uint8Array) => ({ flags: b[20]!, riffSize: b[4]! | (b[5]! << 8) | (b[6]! << 16) | (b[7]! << 24) });

// SVG

export const svg = (body: string, attrs = 'viewBox="0 0 24 24"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

/** `<use>` elements nested over `levels`, each level copying the previous one ten times. */
export function nestedUses(levels: number): string {
  const parts = ['<path id="l0" d="M0 0h1v1z"/>'];
  for (let i = 1; i <= levels; i++) {
    parts.push(`<g id="l${i}">${Array.from({ length: 10 }, () => `<use href="#l${i - 1}"/>`).join("")}</g>`);
  }
  return svg(`<defs>${parts.join("")}</defs><use href="#l${levels}"/>`);
}

/** {@link nestedUses}, then decoys taking the same ids after the real levels: browsers resolve to the first. */
export function nestedUsesBehindDecoys(levels: number): string {
  const decoys = Array.from({ length: levels + 1 }, (_, i) => `<rect id="l${i}"/>`).join("");
  return nestedUses(levels).replace("</svg>", `${decoys}</svg>`);
}

/** {@link nestedUses} with every href percent-encoded, which browsers decode before the lookup. */
export function nestedUsesEncoded(levels: number): string {
  return nestedUses(levels).replace(/href="#l/g, 'href="#%6C');
}

/**
 * Malicious SVGs: `absent` must not appear in the stored file, or the file must be refused with `refused`.
 * Shared by the unit tests of svg.ts and the API tests.
 */
export const MALICIOUS_SVGS: { name: string; svg: string; absent?: string[]; refused?: string }[] = [
  { name: "script element", svg: svg('<script>alert(1)</script><path d="M0 0h1"/>'), absent: ["script", "alert"] },
  { name: "onload attribute", svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" onload="alert(1)"/>', absent: ["onload", "alert"] },
  { name: "event handler in mixed case", svg: svg('<rect width="1" height="1" onClick="alert(1)"/>'), absent: ["onClick", "alert"] },
  { name: "foreignObject", svg: svg('<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x<iframe src="https://evil.example/"/></div></foreignObject>'), absent: ["foreignObject", "iframe", "evil.example"] },
  { name: "external image", svg: svg('<image href="https://evil.example/a.png" width="1" height="1"/>'), absent: ["image", "evil.example"] },
  { name: "external use", svg: svg('<use href="https://evil.example/a.svg#x"/>'), absent: ["evil.example"] },
  { name: "javascript xlink:href", svg: svg('<use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="javascript:alert(1)"/>'), absent: ["javascript", "alert"] },
  { name: "@import in style", svg: svg('<style>@import url(https://evil.example/a.css); path{fill:red}</style><path d="M0 0"/>'), absent: ["@import", "evil.example"] },
  { name: "external url() in style", svg: svg('<style>path{fill:url(https://evil.example/a.svg#g)}</style><path d="M0 0"/>'), absent: ["evil.example"] },
  { name: "image-set() in style", svg: svg('<style>path{background:image-set("https://evil.example/a.png" 1x);fill:red}</style><path d="M0 0"/>'), absent: ["image-set", "evil.example", "background"] },
  { name: "image-set() in a style attribute", svg: svg('<path style="fill:image-set(https://evil.example/a.png 1x)" d="M0 0"/>'), absent: ["image-set", "evil.example"] },
  { name: "external url() in fill", svg: svg('<path fill="url(https://evil.example/a.svg#g)" d="M0 0"/>'), absent: ["evil.example"] },
  { name: "animate element", svg: svg('<rect width="1" height="1"><animate attributeName="x" from="0" to="1" dur="1s" repeatCount="indefinite"/></rect>'), absent: ["animate", "repeatCount"] },
  { name: "set element", svg: svg('<rect width="1" height="1"><set attributeName="fill" to="red"/></rect>'), absent: ["<set", "attributeName"] },
  { name: "CSS animation", svg: svg('<style>@keyframes spin{to{transform:rotate(1turn)}} path{animation:spin 1s infinite;fill:red}</style><path d="M0 0"/>'), absent: ["keyframes", "animation"] },
  { name: "doctype with an entity", svg: '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><text>&x;</text></svg>', refused: "svg_doctype" },
  { name: "xml-stylesheet instruction", svg: `<?xml-stylesheet href="https://evil.example/a.css"?>${svg('<path d="M0 0"/>')}`, absent: ["xml-stylesheet", "evil.example"] },
  { name: "javascript: hidden behind an entity", svg: svg('<a href="&#x6a;avascript:alert(1)"><path d="M0 0"/></a><use href="&#x6a;avascript:alert(1)"/>'), absent: ["javascript", "alert", "<a"] },
  { name: "prefixed html:script", svg: '<svg xmlns="http://www.w3.org/2000/svg" xmlns:html="http://www.w3.org/1999/xhtml" viewBox="0 0 1 1"><html:script>alert(1)</html:script></svg>', absent: ["script", "alert", "xhtml"] },
  { name: "prefixed attribute", svg: '<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="http://www.w3.org/1999/xlink" viewBox="0 0 1 1"><use x:href="https://evil.example/a.svg"/></svg>', absent: ["evil.example", "x:href"] },
  { name: "CDATA outside style", svg: svg('<text><![CDATA[<script>alert(1)</script>]]></text>'), absent: ["script", "alert", "CDATA"] },
  // Nine levels hold 91 uses, under the cap of 100: only the nesting rule refuses them.
  { name: "use nested over 9 levels", svg: nestedUses(9), refused: "svg_too_complex" },
  { name: "use nested behind decoys with the same ids", svg: nestedUsesBehindDecoys(9), refused: "svg_too_complex" },
  { name: "use nested through percent-encoded hrefs", svg: nestedUsesEncoded(9), refused: "svg_too_complex" },
];
