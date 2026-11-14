// Metadata removed at the container level, without decoding: the image is public, and a phone photo often
// carries its GPS position, the device and an author's name. The ICC colour profile is kept.

import { jpegSegments, type Part, pngChunks, type RasterType, webpChunks } from "./sniff";

const PNG_DROPPED = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);
// APP1 (Exif, XMP), APP13 (Photoshop, IPTC) and COM.
const JPEG_DROPPED = new Set(["e1", "ed", "fe"]);
const WEBP_DROPPED = new Set(["EXIF", "XMP "]);
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

function concat(bytes: Uint8Array, parts: { start: number; end: number }[], length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(bytes.subarray(part.start, part.end), at);
    at += part.end - part.start;
  }
  return out;
}

const total = (parts: { start: number; end: number }[]) => parts.reduce((n, p) => n + p.end - p.start, 0);

function stripPng(bytes: Uint8Array, chunks: Part[]): Uint8Array<ArrayBuffer> {
  const kept = [{ start: 0, end: 8 }, ...chunks.filter((c) => !PNG_DROPPED.has(c.type))];
  return concat(bytes, kept, total(kept));
}

function stripJpeg(bytes: Uint8Array, segments: Part[]): Uint8Array<ArrayBuffer> {
  const kept = segments.filter((s) => !JPEG_DROPPED.has(s.type));
  return concat(bytes, kept, total(kept));
}

function stripWebp(bytes: Uint8Array, chunks: Part[]): Uint8Array<ArrayBuffer> {
  const kept = [{ start: 0, end: 12 }, ...chunks.filter((c) => !WEBP_DROPPED.has(c.type))];
  const out = concat(bytes, kept, total(kept));
  const view = new DataView(out.buffer);
  view.setUint32(4, out.length - 8, true);
  // The VP8X flags must not announce chunks that are gone.
  if (chunks[0]?.type === "VP8X") out[12 + 8] = out[12 + 8]! & ~(VP8X_EXIF | VP8X_XMP);
  return out;
}

/**
 * Return the image without its metadata blocks, and without anything after its end marker.
 *
 * Call it on an image `inspectRaster` accepted; it returns null when the container cannot be walked.
 */
export function stripMetadata(bytes: Uint8Array, type: RasterType): Uint8Array<ArrayBuffer> | null {
  if (type === "image/png") {
    const chunks = pngChunks(bytes);
    return chunks && stripPng(bytes, chunks);
  }
  if (type === "image/jpeg") {
    const segments = jpegSegments(bytes);
    return segments && stripJpeg(bytes, segments);
  }
  const chunks = webpChunks(bytes);
  return chunks && stripWebp(bytes, chunks);
}
