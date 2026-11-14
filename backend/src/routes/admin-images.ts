import { type Context, Hono } from "hono";

import { sessionFor } from "../auth";
import type { AppEnv } from "../context";
import { apiError } from "../errors";
import { MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, MAX_IMAGES } from "../images/limits";
import { decodeBase64, type Prepared, prepareImage } from "../images/prepare";
import type { InvalidReason } from "../images/sniff";
import { storeImage } from "../images/store";
import { OutboundError, type OutboundErrorCode, type OutboundResponse } from "../net/outbound";
import { checkTarget } from "../net/policy";
import { IMAGE_FETCH_LIMIT, reserveAttempt } from "../rate-limit";
import { SOURCE_REPOSITORY, version } from "../version";
import { readJson } from "./body";
import { requireAdmin } from "./require-admin";

export const adminImages = new Hono<AppEnv>();

// Neither catalogWritable nor CATALOG_FILE: a logo can always be uploaded, and a link's icon stays locked
// under CATALOG_FILE by the link's own route.
adminImages.use("*", requireAdmin);

const MAX_OF: Partial<Record<InvalidReason, number>> = { too_large: MAX_IMAGE_BYTES, dimensions: MAX_IMAGE_SIDE };

/** Store a prepared image and answer as an upload does, or say why it is refused. */
async function storeAndAnswer(c: Context<AppEnv>, prepared: Prepared) {
  if (!prepared.ok) {
    const max = MAX_OF[prepared.reason];
    return apiError(c, 422, "invalid_image", "The image cannot be used.", { reason: prepared.reason, ...(max === undefined ? {} : { max }) });
  }
  const stored = await storeImage(c.var.db, prepared.image, Date.now());
  if (stored === "images_full") return apiError(c, 409, "images_full", "Too many images are stored.", { max: MAX_IMAGES });
  return c.json({ image: { ...stored, sanitized: prepared.image.sanitized } }, 201);
}

/** Store an image sent as `{ data: <base64> }`; the upload alone writes no audit entry, citing it does. */
adminImages.post("/", async (c) => {
  const { data } = await readJson(c);
  if (typeof data !== "string") return apiError(c, 422, "invalid_input", "Send the image as base64 in `data`.");
  const bytes = decodeBase64(data);
  const prepared = bytes === null ? ({ ok: false, reason: "unreadable" } as const) : bytes === "too_large" ? ({ ok: false, reason: bytes } as const) : prepareImage(bytes);
  return storeAndAnswer(c, prepared);
});

const FETCH_OPTIONS = {
  deadlineMs: 10_000,
  maxBytes: MAX_IMAGE_BYTES,
  maxRedirects: 3,
  headers: {
    Accept: "image/png, image/jpeg, image/webp, image/svg+xml",
    "User-Agent": `YASAD-icons/${version} (+${SOURCE_REPOSITORY})`,
  },
};

/** Codes the target policy gives: the address is not one the server may call, so the file must be uploaded. */
const REFUSED: ReadonlySet<OutboundErrorCode> = new Set(["blocked_address", "blocked_port", "unsupported_on_target"]);

/**
 * Fetch an image from `{ url }` once, check it as an upload and store it; the URL itself is not kept.
 *
 * Every fetch is counted against the admin before any request goes out. The received `Content-Type` is ignored: the
 * type is read from the bytes, like an upload.
 */
adminImages.post("/fetch", async (c) => {
  const { url } = await readJson(c);
  if (typeof url !== "string") return apiError(c, 422, "invalid_input", "Send the image's address in `url`.");

  const actorId = (await sessionFor(c))!.user.id;
  const attempt = await reserveAttempt(c.var.db, `image-fetch:${actorId}`, IMAGE_FETCH_LIMIT);
  if (!attempt.allowed) {
    c.header("Retry-After", String(Math.ceil(attempt.retryAfterMs / 1000)));
    return apiError(c, 429, "rate_limited", "Too many attempts. Try again later.");
  }

  const target = checkTarget(url);
  if (!target.ok && target.code === "invalid_target") {
    return apiError(c, 422, "image_fetch_refused", "Give an http or https address without a user name or password.", { reason: "invalid_url" });
  }

  let response: OutboundResponse;
  try {
    response = await c.var.outbound.request(url, FETCH_OPTIONS);
  } catch (error) {
    if (!(error instanceof OutboundError)) throw error;
    const reason = error.code;
    if (REFUSED.has(reason)) {
      return apiError(c, 422, "image_fetch_refused", "The server does not fetch this address. Give a public host name, or upload the file.", { reason });
    }
    if (reason === "too_large") return apiError(c, 422, "invalid_image", "The image cannot be used.", { reason, max: MAX_IMAGE_BYTES });
    if (reason === "not_attempted") return apiError(c, 503, "image_fetch_failed", "The image could not be fetched now. Try again later.", { reason });
    return apiError(c, 422, "image_fetch_failed", "The image could not be fetched.", { reason });
  }
  if (response.status !== 200) {
    return apiError(c, 422, "image_fetch_failed", "The image could not be fetched.", { reason: "http_error", status: response.status });
  }
  return storeAndAnswer(c, prepareImage(response.body ?? new Uint8Array()));
});
