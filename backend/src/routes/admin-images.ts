import { Hono } from "hono";

import type { AppEnv } from "../context";
import { apiError } from "../errors";
import { MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, MAX_IMAGES } from "../images/limits";
import { decodeBase64, prepareImage } from "../images/prepare";
import type { InvalidReason } from "../images/sniff";
import { storeImage } from "../images/store";
import { readJson } from "./body";
import { requireAdmin } from "./require-admin";

export const adminImages = new Hono<AppEnv>();

// Neither catalogWritable nor CATALOG_FILE: a logo can always be uploaded, and a link's icon stays locked
// under CATALOG_FILE by the link's own route.
adminImages.use("*", requireAdmin);

const MAX_OF: Partial<Record<InvalidReason, number>> = { too_large: MAX_IMAGE_BYTES, dimensions: MAX_IMAGE_SIDE };

/** Store an image sent as `{ data: <base64> }`; the upload alone writes no audit entry, citing it does. */
adminImages.post("/", async (c) => {
  const { data } = await readJson(c);
  if (typeof data !== "string") return apiError(c, 422, "invalid_input", "Send the image as base64 in `data`.");
  const bytes = decodeBase64(data);
  const prepared = bytes === null ? ({ ok: false, reason: "unreadable" } as const) : bytes === "too_large" ? ({ ok: false, reason: bytes } as const) : prepareImage(bytes);
  if (!prepared.ok) {
    const max = MAX_OF[prepared.reason];
    return apiError(c, 422, "invalid_image", "The image cannot be used.", { reason: prepared.reason, ...(max === undefined ? {} : { max }) });
  }
  const stored = await storeImage(c.var.db, prepared.image, Date.now());
  if (stored === "images_full") return apiError(c, 409, "images_full", "Too many images are stored.", { max: MAX_IMAGES });
  return c.json({ image: { ...stored, sanitized: prepared.image.sanitized } }, 201);
});
