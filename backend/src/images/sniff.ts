// Image type and size read from the bytes, never from a Content-Type. Nothing is decoded: only the container's
// headers are read, so this runs within the CPU budget of a Workers request.

import { MAX_IMAGE_SIDE } from "./limits";

export type ImageType = "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";
export type RasterType = Exclude<ImageType, "image/svg+xml">;

/** Why an image is refused, sent as `reason` with `invalid_image`. */
export type InvalidReason = "too_large" | "unsupported_type" | "unreadable" | "dimensions" | "animated" | "svg_doctype" | "svg_too_complex";

/** A part of a container: `start` and `end` bound it whole, `data` is where its payload starts. */
export type Part = { type: string; start: number; data: number; end: number };

const u16be = (b: Uint8Array, at: number) => (b[at]! << 8) | b[at + 1]!;
const u32be = (b: Uint8Array, at: number) => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
const u16le = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8);
const u24le = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);
const u32le = (b: Uint8Array, at: number) => (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
const ascii = (b: Uint8Array, at: number, length: number) => String.fromCharCode(...b.subarray(at, at + length));
const startsWith = (b: Uint8Array, signature: readonly number[], at = 0) => signature.every((v, i) => b[at + i] === v);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Return the type a file's signature gives, or null; a text file that may be an SVG gives `image/svg+xml`. */
export function sniffType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  return looksLikeSvg(bytes) ? "image/svg+xml" : null;
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  return text.trimStart().startsWith("<") && text.includes("<svg");
}

/** Return the chunks of a PNG up to IEND included, or null when a chunk runs past the end or IEND is missing. */
export function pngChunks(b: Uint8Array): Part[] | null {
  if (!startsWith(b, PNG_SIGNATURE)) return null;
  const chunks: Part[] = [];
  for (let at = PNG_SIGNATURE.length; at + 12 <= b.length; ) {
    const end = at + 12 + u32be(b, at);
    if (end > b.length) return null;
    const type = ascii(b, at + 4, 4);
    chunks.push({ type, start: at, data: at + 8, end });
    if (type === "IEND") return chunks;
    at = end;
  }
  return null;
}

const isRestart = (marker: number) => marker >= 0xd0 && marker <= 0xd7;

/**
 * Return the segments of a JPEG up to EOI included, or null when it is cut short.
 *
 * A start-of-scan segment runs to the next marker, so it carries the entropy-coded data after its header.
 * `type` is the marker in two hex digits (`e1` for APP1).
 */
export function jpegSegments(b: Uint8Array): Part[] | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  const segments: Part[] = [{ type: "d8", start: 0, data: 2, end: 2 }];
  let at = 2;
  for (;;) {
    if (at >= b.length || b[at] !== 0xff) return null;
    const start = at;
    while (b[at] === 0xff) at++;
    if (at >= b.length) return null;
    const marker = b[at]!;
    at++;
    const type = marker.toString(16).padStart(2, "0");
    if (marker === 0xd9) {
      segments.push({ type, start, data: at, end: at });
      return segments;
    }
    if (isRestart(marker) || marker === 0x01) {
      segments.push({ type, start, data: at, end: at });
      continue;
    }
    if (at + 2 > b.length) return null;
    const length = u16be(b, at);
    if (length < 2 || at + length > b.length) return null;
    let end = at + length;
    if (marker === 0xda) {
      // Entropy-coded data: 0xFF is followed by 0x00 (a stuffed byte) or a restart marker, else a marker starts.
      while (end + 1 < b.length && !(b[end] === 0xff && b[end + 1] !== 0x00 && !isRestart(b[end + 1]!))) end++;
      if (end + 1 >= b.length) return null;
    }
    segments.push({ type, start, data: at + 2, end });
    at = end;
  }
}

/** Return the chunks of a WebP inside its RIFF size, or null when the file is shorter than RIFF says. */
export function webpChunks(b: Uint8Array): Part[] | null {
  if (b.length < 12 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  const total = u32le(b, 4) + 8;
  if (total > b.length) return null;
  const chunks: Part[] = [];
  for (let at = 12; at < total; ) {
    if (at + 8 > total) return null;
    const size = u32le(b, at + 4);
    const dataEnd = at + 8 + size;
    if (dataEnd > total) return null;
    // Chunks are padded to an even size; a missing last pad byte is tolerated.
    const end = Math.min(dataEnd + (size & 1), total);
    chunks.push({ type: ascii(b, at, 4), start: at, data: at + 8, end });
    at = end;
  }
  return chunks;
}

type Size = { width: number; height: number };
export type RasterInfo = { ok: true; width: number; height: number } | { ok: false; reason: InvalidReason };

function pngInfo(b: Uint8Array): Size | "animated" | null {
  const chunks = pngChunks(b);
  const header = chunks?.[0];
  if (!chunks || header?.type !== "IHDR" || header.end - header.data - 4 !== 13) return null;
  if (!chunks.some((c) => c.type === "IDAT")) return null;
  if (chunks.some((c) => c.type === "acTL")) return "animated";
  return { width: u32be(b, header.data), height: u32be(b, header.data + 4) };
}

// Start-of-frame markers: C0 to CF, except DHT (C4), JPG (C8) and DAC (CC).
const isFrame = (marker: number) => marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

function jpegInfo(b: Uint8Array): Size | null {
  const segments = jpegSegments(b);
  const frame = segments?.find((s) => isFrame(parseInt(s.type, 16)));
  if (!frame || frame.end - frame.data < 5) return null;
  return { height: u16be(b, frame.data + 1), width: u16be(b, frame.data + 3) };
}

/** Return the size of a lossy (`VP8 `) or lossless (`VP8L`) bitstream chunk, or null. */
function bitstreamSize(b: Uint8Array, chunk: Part): Size | null {
  const d = chunk.data;
  const length = chunk.end - d;
  if (chunk.type === "VP8 ") {
    if (length < 10 || !startsWith(b, [0x9d, 0x01, 0x2a], d + 3)) return null;
    return { width: u16le(b, d + 6) & 0x3fff, height: u16le(b, d + 8) & 0x3fff };
  }
  if (length < 5 || b[d] !== 0x2f) return null;
  const bits = u32le(b, d + 1);
  return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
}

/** VP8X flag of an animated WebP. */
export const VP8X_ANIMATION = 0x02;

function webpInfo(b: Uint8Array): Size | "animated" | null {
  const chunks = webpChunks(b);
  if (!chunks || chunks.length === 0) return null;
  const bitstream = chunks.find((c) => c.type === "VP8 " || c.type === "VP8L");
  const first = chunks[0]!;
  if (first.type === "VP8X") {
    if (first.end - first.data < 10) return null;
    if (b[first.data]! & VP8X_ANIMATION || chunks.some((c) => c.type === "ANIM" || c.type === "ANMF")) return "animated";
    if (!bitstream || !bitstreamSize(b, bitstream)) return null;
    return { width: u24le(b, first.data + 4) + 1, height: u24le(b, first.data + 7) + 1 };
  }
  return bitstream === first ? bitstreamSize(b, first) : null;
}

/** Return the size of a raster image read from its headers, or why it is refused. */
export function inspectRaster(bytes: Uint8Array, type: RasterType): RasterInfo {
  const info = type === "image/png" ? pngInfo(bytes) : type === "image/jpeg" ? jpegInfo(bytes) : webpInfo(bytes);
  if (info === "animated") return { ok: false, reason: "animated" };
  if (!info || info.width === 0 || info.height === 0) return { ok: false, reason: "unreadable" };
  if (info.width > MAX_IMAGE_SIDE || info.height > MAX_IMAGE_SIDE) return { ok: false, reason: "dimensions" };
  return { ok: true, width: info.width, height: info.height };
}
