import { MAX_IMAGE_BYTES } from "./limits";
import { type ImageType, type InvalidReason, inspectRaster, sniffType } from "./sniff";
import { stripMetadata } from "./strip";
import { sanitizeSvg } from "./svg";

/** An image ready to store: its bytes as served, its type and size, and whether its SVG lost something. */
export type PreparedImage = { type: ImageType; width: number; height: number; bytes: Uint8Array<ArrayBuffer>; sanitized: boolean };

export type Prepared = { ok: true; image: PreparedImage } | { ok: false; reason: InvalidReason };

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
/** Longest base64 text of an image that may fit, checked before decoding anything. */
const MAX_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

/** Return the bytes of a base64 text, "too_large" past the limit, or null when it is not base64. */
export function decodeBase64(data: string): Uint8Array<ArrayBuffer> | "too_large" | null {
  if (data.length > MAX_BASE64_LENGTH + 4) return "too_large";
  if (!BASE64.test(data)) return null;
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Return the image to store, or why it is refused: type read from the bytes, size read from the headers,
 * animation refused, metadata removed from raster images and SVG rebuilt from the allow-list. Never re-encoded.
 */
export function prepareImage(bytes: Uint8Array): Prepared {
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: "too_large" };
  const type = sniffType(bytes);
  if (type === null) return { ok: false, reason: "unsupported_type" };
  if (type === "image/svg+xml") {
    const svg = sanitizeSvg(bytes);
    if (!svg.ok) return svg;
    // The rewrite escapes and declares namespaces, so it can grow a little past what was received.
    if (svg.bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: "too_large" };
    return { ok: true, image: { type, width: svg.width, height: svg.height, bytes: svg.bytes, sanitized: svg.sanitized } };
  }
  const info = inspectRaster(bytes, type);
  if (!info.ok) return info;
  const stripped = stripMetadata(bytes, type);
  if (!stripped) return { ok: false, reason: "unreadable" };
  return { ok: true, image: { type, width: info.width, height: info.height, bytes: stripped, sanitized: false } };
}
