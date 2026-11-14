// The only place images are written and read. Nothing references an image by foreign key: `link.icon` and the
// `instance.logo` setting cite it as `image:<id>`, and an image cited by nothing is purged by later writes.

import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";

import { failWhen } from "../audit";
import type { DB } from "../db";
import { image } from "../schema";
import { MAX_IMAGES, ORPHAN_GRACE_MS, ORPHAN_PURGE_BATCH } from "./limits";
import type { PreparedImage } from "./prepare";
import type { ImageType } from "./sniff";

export type StoredImage = { id: string; type: ImageType; width: number; height: number; size: number };

/** Image ids as cited in the catalog and the settings: 32 lowercase hex characters. */
export const IMAGE_ID = /^[0-9a-f]{32}$/;

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** True when no link and no setting cites the image of the outer query. */
const orphan = sql`not exists (select 1 from link where link.icon = 'image:' || ${image.id})
  and not exists (select 1 from setting where setting.key = 'instance.logo' and setting.value = 'image:' || ${image.id})`;

/**
 * Return the statement deleting up to {@link ORPHAN_PURGE_BATCH} images cited by nothing and older than the grace
 * period, for the batch of any write that may leave one behind. The image with the hash `spare` is kept: an upload
 * of the same bytes must keep its id.
 */
export function purgeOrphans(db: DB, now: number, spare?: string) {
  return db
    .delete(image)
    .where(
      inArray(
        image.id,
        db
          .select({ id: image.id })
          .from(image)
          .where(and(lt(image.createdAt, new Date(now - ORPHAN_GRACE_MS)), orphan, spare === undefined ? undefined : ne(image.sha256, spare)))
          .orderBy(image.createdAt)
          .limit(ORPHAN_PURGE_BATCH),
      ),
    );
}

/**
 * Store an image and return it, or "images_full" when {@link MAX_IMAGES} are kept and none has the same bytes.
 *
 * One batch: the purge goes first, else a database full of orphans would fail the guard, hence the whole batch,
 * and never be purged. An image with the same bytes keeps its id and starts its grace period again.
 */
export async function storeImage(db: DB, prepared: PreparedImage, now: number): Promise<StoredImage | "images_full"> {
  const sha256 = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", prepared.bytes)));
  const id = hex(crypto.getRandomValues(new Uint8Array(16)));
  const full = sql`(select count(*) from image) >= ${MAX_IMAGES} and not exists (select 1 from image where sha256 = ${sha256})`;
  try {
    await db.batch([
      purgeOrphans(db, now, sha256),
      failWhen(db, full),
      db
        .insert(image)
        .values({
          id,
          sha256,
          type: prepared.type,
          width: prepared.width,
          height: prepared.height,
          size: prepared.bytes.length,
          bytes: prepared.bytes,
          createdAt: new Date(now),
        })
        .onConflictDoUpdate({ target: image.sha256, set: { createdAt: new Date(now) } }),
    ]);
  } catch (error) {
    const row = await db.get<{ v: number }>(sql`select ${full} as v`);
    if (row?.v) return "images_full";
    throw error;
  }
  const stored = await db
    .select({ id: image.id, type: image.type, width: image.width, height: image.height, size: image.size })
    .from(image)
    .where(eq(image.sha256, sha256))
    .get();
  return stored!;
}

/**
 * Return the statement failing the batch when the image `id` is not stored, for any write that sets an
 * `image:<id>` reference: the purge may remove an image between its upload and the save that cites it.
 * After a failed batch, read the table again to answer `unknown_image`.
 */
export function imageExists(db: DB, id: string) {
  return failWhen(db, sql`not exists (select 1 from image where id = ${id})`);
}

/** Return the type and bytes of an image, or null for an unknown id. */
export async function readImage(db: DB, id: string): Promise<{ type: ImageType; bytes: Uint8Array<ArrayBuffer> } | null> {
  if (!IMAGE_ID.test(id)) return null;
  return (await db.select({ type: image.type, bytes: image.bytes }).from(image).where(eq(image.id, id)).get()) ?? null;
}
