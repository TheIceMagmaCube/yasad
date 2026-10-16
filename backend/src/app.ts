import { sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { sessionFor } from "./auth";
import { type Config, loadConfig, type RawConfig } from "./config";
import type { AppEnv } from "./context";
import type { DB } from "./db";
import { apiError } from "./errors";
import { accountRoutes } from "./routes/account";
import { adminCatalog, MAX_CATALOG_BODY } from "./routes/admin-catalog";
import { adminGroups } from "./routes/admin-groups";
import { adminUsers } from "./routes/admin-users";
import { authRoutes } from "./routes/auth";
import { home } from "./routes/home";
import { instance } from "./routes/instance";
import { setup } from "./routes/setup";
import { sameOriginOnly, withSecurityHeaders } from "./security";
import { version } from "./version";

export type { AppEnv } from "./context";

const MAX_BODY = 16 * 1024;
const OPEN_WITH_TEMPORARY_PASSWORD = new Set([
  "GET /api/auth/get-session",
  "POST /api/auth/sign-out",
  "GET /api/instance",
  "GET /api/health",
  "POST /api/account/password",
]);

/** Runtime services each entry (server.ts, worker.ts) provides. */
export type AppDeps = {
  getDb: (env: unknown) => DB;
  getRawConfig: (env: unknown) => RawConfig;
  getClientIp: (c: Context<AppEnv>) => string;
};

// Runtime-agnostic application.
export function createApp({ getDb, getRawConfig, getClientIp }: AppDeps) {
  const app = new Hono<AppEnv>().basePath("/api");

  app.use("*", withSecurityHeaders<AppEnv>((c) => c.get("config")?.publicUrl.startsWith("https://") ?? false));

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

  app.use("*", sameOriginOnly);
  const tooLarge = (c: Context) => apiError(c, 413, "payload_too_large", "The request body is too large.");
  const catalogLimit = bodyLimit({ maxSize: MAX_CATALOG_BODY, onError: tooLarge });
  const defaultLimit = bodyLimit({ maxSize: MAX_BODY, onError: tooLarge });
  // Catalog files can be larger than any other request body.
  app.use("*", (c, next) => (c.req.path === "/api/admin/catalog" ? catalogLimit : defaultLimit)(c, next));

  // While a temporary password is set, only these routes answer; the rest of the API is refused.
  app.use("*", async (c, next) => {
    if (OPEN_WITH_TEMPORARY_PASSWORD.has(`${c.req.method} ${c.req.path}`) || !c.req.header("cookie")) return next();
    const current = await sessionFor(c);
    if (current?.user.mustChangePassword) {
      return apiError(c, 403, "password_change_required", "Choose a new password before going on.");
    }
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

  app.onError((err, c) => {
    console.error(err);
    return apiError(c, 500, "internal_error", "Something went wrong on the server. See the server logs.");
  });

  app.route("/home", home);
  app.route("/instance", instance);
  app.route("/setup", setup);
  app.route("/account", accountRoutes);
  app.route("/admin/catalog", adminCatalog);
  app.route("/admin/users", adminUsers);
  app.route("/admin/groups", adminGroups);
  app.route("/auth", authRoutes);

  return app;
}
