import { Hono } from "hono";

import type { AppEnv } from "../context";
import { apiError } from "../errors";
import { readImage } from "../images/store";

export const images = new Hono<AppEnv>();

/**
 * Serve a stored image to anyone who knows its address: the id cannot be guessed, and only a visible link or the
 * logo sends it. The content of an id never changes, hence the immutable cache; the image CSP comes from security.ts.
 */
images.get("/:id", async (c) => {
  const found = await readImage(c.var.db, c.req.param("id"));
  if (!found) {
    c.header("Cache-Control", "no-store");
    return apiError(c, 404, "not_found", "No such image.");
  }
  return c.body(found.bytes, 200, {
    "Content-Type": found.type,
    "Cache-Control": "public, max-age=31536000, immutable",
  });
});
