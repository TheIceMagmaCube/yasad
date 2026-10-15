import { sql } from "drizzle-orm";
import { type Context, Hono } from "hono";

import { authFor } from "./auth";
import { type Config, loadConfig, type RawConfig } from "./config";
import type { AppEnv } from "./context";
import type { DB } from "./db";
import { apiError } from "./errors";
import { setup } from "./routes/setup";
import { version } from "./version";

export type { AppEnv } from "./context";

/** Runtime services each entry (server.ts, worker.ts) provides. */
export type AppDeps = {
  getDb: (env: unknown) => DB;
  getRawConfig: (env: unknown) => RawConfig;
  getClientIp: (c: Context<AppEnv>) => string;
};

// Runtime-agnostic application.
export function createApp({ getDb, getRawConfig, getClientIp }: AppDeps) {
  const app = new Hono<AppEnv>().basePath("/api");

  app.use("*", async (c, next) => {
    let config: Config;
    try {
      config = loadConfig(getRawConfig(c.env));
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      return apiError(c, 500, "invalid_config", "The server configuration is invalid. See the server logs.");
    }
    c.set("config", config);
    c.set("db", getDb(c.env));
    c.set("clientIp", getClientIp(c));
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

  app.route("/setup", setup);
  app.on(["GET", "POST"], "/auth/*", (c) => authFor(c).handler(c.req.raw));

  return app;
}
