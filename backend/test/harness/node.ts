// Node harness: the app on an in-memory libSQL database (Docker target).
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

import { createApp } from "../../src/app";
import type { DB } from "../../src/db";
import * as schema from "../../src/schema";
import { BASE_ENV, client, type TestApp, type TestEnv } from "./shared";

export { BASE_ENV, TEST_IP } from "./shared";
export const target = "node";

/** Return a client on a fresh in-memory database. */
export async function testApp(env: TestEnv = {}): Promise<TestApp> {
  const libsql = createClient({ url: ":memory:" });
  const db = drizzle(libsql, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  const raw = { ...BASE_ENV, ...env };
  const app = createApp({
    getDb: () => db as unknown as DB,
    getRawConfig: () => raw,
    getClientIp: (c) => c.req.header("cf-connecting-ip") ?? "unknown",
  });
  return client(
    async (req) => app.fetch(req),
    async (sql) => {
      await libsql.execute(sql);
    },
    async (sql) => (await libsql.execute(sql)).rows.map((row) => ({ ...row })),
    async (sqls) => {
      await libsql.batch(sqls, "write");
    },
  );
}

export async function request(path: string, init?: RequestInit): Promise<Response> {
  return (await testApp()).request(path, init);
}
