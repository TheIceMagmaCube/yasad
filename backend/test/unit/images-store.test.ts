import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { describe, expect, it } from "vitest";

import type { DB } from "../../src/db";
import { prepareImage } from "../../src/images/prepare";
import { imageExists, storeImage } from "../../src/images/store";
import * as schema from "../../src/schema";
import { png } from "../harness/images";

async function database(): Promise<DB> {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return db as unknown as DB;
}

describe("imageExists", () => {
  it("fails the batch when the cited image is not stored, and lets it through otherwise", async () => {
    const db = await database();
    const write = db.insert(schema.setting).values({ key: "instance.logo", value: "image:x" });
    await expect(db.batch([imageExists(db, "f".repeat(32)), write])).rejects.toThrow();
    expect(await db.select().from(schema.setting).all()).toEqual([]);

    const prepared = prepareImage(png());
    if (!prepared.ok) throw new Error(prepared.reason);
    const stored = await storeImage(db, prepared.image, Date.now());
    if (stored === "images_full") throw new Error("images_full");
    await db.batch([imageExists(db, stored.id), write]);
    expect(await db.select().from(schema.setting).all()).toHaveLength(1);
  });
});
