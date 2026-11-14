// Constants, not settings: they follow D1's limits and the Workers CPU budget, not a choice of the instance.

/** Largest stored image, in bytes: under D1's limit per value and the CPU budget of a Workers Free request. */
export const MAX_IMAGE_BYTES = 256 * 1024;

/** Largest body of an upload: the image in base64 plus the JSON envelope. */
export const MAX_IMAGE_BODY = 360 * 1024;

/** Longest side of a raster image, in pixels: room for a logo, and a bound on what browsers decode. */
export const MAX_IMAGE_SIDE = 2048;

/** Images kept at most: 250 MiB in the worst case, under the 500 MB of a D1 Free database. */
export const MAX_IMAGES = 1000;

/** Bounds on an SVG, so its rewrite stays short. */
export const MAX_SVG_ELEMENTS = 5000;
export const MAX_SVG_DEPTH = 64;
/** `<use>` elements at most: each one copies part of the drawing again. */
export const MAX_SVG_USES = 100;

/** How long an image cited by nothing is kept, so the link or the logo can be saved after the upload. */
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

/** Orphans removed at most by one write, like the audit log's purge. */
export const ORPHAN_PURGE_BATCH = 100;
