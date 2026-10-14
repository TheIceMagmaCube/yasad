import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import type { DB } from "../src/db";
import * as schema from "../src/schema";

async function testApp() {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return createApp(() => db as unknown as DB);
}

describe("GET /api/health", () => {
  it("reports the version and a reachable database", async () => {
    const res = await (await testApp()).request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, database: true, version: expect.any(String) });
  });

  it("answers 404 outside known routes", async () => {
    const res = await (await testApp()).request("/api/nope");
    expect(res.status).toBe(404);
  });
});
