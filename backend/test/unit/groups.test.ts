import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { describe, expect, it } from "vitest";

import { findOrCreateGroup } from "../../src/catalog/groups";
import { importCatalog } from "../../src/catalog/sync";
import type { DB } from "../../src/db";
import * as schema from "../../src/schema";

async function database(): Promise<DB> {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return db as unknown as DB;
}

const FILE = `version: 1
categories:
  - id: dev
    title: Dev
    groups: ["oidc:Developers"]
`;

describe("findOrCreateGroup", () => {
  it("returns the group an import created instead of a duplicate", async () => {
    const db = await database();
    await importCatalog(db, FILE, { dryRun: false });
    const [created] = await db.select().from(schema.group).where(eq(schema.group.name, "Developers"));
    expect(await findOrCreateGroup(db, { source: "oidc", name: "Developers" })).toBe(created!.id);
    expect(await db.select().from(schema.group)).toHaveLength(3);
  });

  it("keeps an OIDC group apart from a local group of the same name", async () => {
    const db = await database();
    const oidc = await findOrCreateGroup(db, { source: "oidc", name: "Developers" });
    expect(await findOrCreateGroup(db, { source: "local", name: "Developers" })).not.toBe(oidc);
  });

  it("finds the system groups created by the migrations", async () => {
    const db = await database();
    expect(await findOrCreateGroup(db, { source: "system", name: "everyone" })).toBe("system:everyone");
    expect(await findOrCreateGroup(db, { source: "system", name: "authenticated" })).toBe("system:authenticated");
  });
});

describe("docs/catalog.example.yaml", () => {
  it("is a valid catalog", async () => {
    const { readFile } = await import("node:fs/promises");
    const { parseCatalog } = await import("../../src/catalog/format");
    const parsed = parseCatalog(await readFile(new URL("../../../docs/catalog.example.yaml", import.meta.url), "utf8"));
    expect(parsed.ok ? [] : parsed.errors).toEqual([]);
  });
});
