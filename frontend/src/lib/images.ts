import { ApiError } from "../api";
import type { Messages } from "../i18n/en";
import { errorMessage } from "../i18n/errors";

/** Largest image and longest side, as the server checks them: said in the hints, the size checked before an upload. */
export const MAX_IMAGE_BYTES = 256 * 1024;
export const MAX_IMAGE_SIDE = 2048;
/** Types the server accepts, also the file picker's filter; the server reads the type from the bytes anyway. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;
/** Name of each accepted type, as people read it. */
export const TYPE_NAMES: Record<string, string> = { "image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WebP", "image/svg+xml": "SVG" };

/** Return the address an uploaded image is served at. */
export const imageSrc = (id: string) => `/api/images/${id}`;

/** Return a size in bytes as people read it: bytes under 1 KiB, else KiB with one decimal at most. */
export function sizeText(bytes: number, language: string, m: Messages): string {
  if (bytes < 1024) return m.appearance.sizes.bytes(new Intl.NumberFormat(language).format(bytes));
  return m.appearance.sizes.kib(new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(bytes / 1024));
}

/** Return why a chosen file cannot be uploaded, checked before sending it, or null when it may be sent. */
export function fileProblem(file: File, language: string, m: Messages): string | null {
  if (file.size > MAX_IMAGE_BYTES) return m.images.errors.too_large(sizeText(file.size, language, m), sizeText(MAX_IMAGE_BYTES, language, m));
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) return m.images.errors.unsupported_type;
  return null;
}

/** Return why the server refused an image, uploaded or fetched, with the limit in figures. */
export function imageErrorText(err: unknown, language: string, m: Messages): string {
  const e = m.images.errors;
  if (!(err instanceof ApiError)) return errorMessage(err, m);
  const { code, reason, max, status } = err.body;
  if (code === "images_full") return e.images_full;
  if (code === "image_fetch_refused") {
    const refused = m.images.fetch.errors.refused;
    return reason && Object.hasOwn(refused, reason) ? refused[reason as keyof typeof refused] : refused.blocked_address;
  }
  if (code === "image_fetch_failed") {
    const failed = m.images.fetch.errors.failed;
    if (reason === "http_error") return failed.http_error(status ?? 0);
    return reason && Object.hasOwn(failed, reason) && reason !== "http_error" ? (failed[reason as keyof typeof failed] as string) : failed.other;
  }
  if (code !== "invalid_image") return errorMessage(err, m);
  switch (reason) {
    case "too_large":
      return e.too_large_max(sizeText(max ?? MAX_IMAGE_BYTES, language, m));
    case "dimensions":
      return e.dimensions(new Intl.NumberFormat(language).format(max ?? MAX_IMAGE_SIDE));
    case "unsupported_type":
    case "unreadable":
    case "animated":
    case "svg_doctype":
    case "svg_too_complex":
      return e[reason];
    default:
      return e.unreadable;
  }
}

/** Return the file's content in base64, as the upload sends it. */
export function readBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^[^,]*,/, ""));
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
}
