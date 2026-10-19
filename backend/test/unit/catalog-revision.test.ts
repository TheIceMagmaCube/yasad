import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { describe, expect, it } from "vitest";

import { importCatalog } from "../../src/catalog/sync";
import type { DB } from "../../src/db";
import * as schema from "../../src/schema";

/** Import options as an admin applying the file. */
const as = (db: DB, options: { dryRun: boolean; baseVersion?: string }) => ({ ...options, auditor: { db, actorId: "ada", retentionDays: 365 } });

async function database(): Promise<DB> {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return db as unknown as DB;
}

const fileTitled = (title: string) => `version: 1
categories:
  - id: dev
    title: ${title}
    groups: ["@everyone"]
`;

/** Return the database, where another import is applied just before the next batch runs. */
function racedBy(db: DB, file: string): DB {
  let raced = false;
  return new Proxy(db, {
    get(target, key) {
      if (key === "batch" && !raced) {
        return async (queries: readonly [unknown, ...unknown[]]) => {
          raced = true;
          await importCatalog(target, file, as(target, { dryRun: false }));
          return target.batch(queries);
        };
      }
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

describe("catalog revision", () => {
  it("increases with each write, and not for an import that changes nothing", async () => {
    const db = await database();
    expect(await importCatalog(db, fileTitled("Dev"), as(db, { dryRun: true }))).toMatchObject({ baseVersion: "0" });
    await importCatalog(db, fileTitled("Dev"), as(db, { dryRun: false }));
    await importCatalog(db, fileTitled("Dev"), as(db, { dryRun: false }));
    expect(await importCatalog(db, fileTitled("Dev"), as(db, { dryRun: true }))).toMatchObject({ baseVersion: "1" });
  });

  it("rolls back a write when another one lands between the check and the batch", async () => {
    const db = await database();
    await importCatalog(db, fileTitled("Dev"), as(db, { dryRun: false }));
    const result = await importCatalog(racedBy(db, fileTitled("Other")), fileTitled("Mine"), as(db, { dryRun: false, baseVersion: "1" }));
    expect(result).toEqual({ status: "changed" });
    expect(await db.select({ title: schema.category.title }).from(schema.category)).toEqual([{ title: "Other" }]);
    // One entry for each import applied before, none for the refused one.
    expect(await db.select({ actor: schema.auditLog.actorId }).from(schema.auditLog)).toEqual([{ actor: "ada" }, { actor: "ada" }]);
  });
});
