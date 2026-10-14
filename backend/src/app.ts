import { sql } from "drizzle-orm";
import { Hono } from "hono";

import type { DB } from "./db";
import { version } from "./version";

export type AppEnv = { Variables: { db: DB } };

// Runtime-agnostic application. worker.ts and server.ts only provide the database.
export function createApp(getDb: (env: unknown) => DB) {
  const app = new Hono<AppEnv>().basePath("/api");

  app.use("*", async (c, next) => {
    c.set("db", getDb(c.env));
    await next();
  });

  app.get("/health", async (c) => {
    let database = true;
    try {
      await c.var.db.run(sql`select 1`);
    } catch {
      database = false;
    }
    return c.json({ ok: database, version, database }, database ? 200 : 503);
  });

  return app;
}
