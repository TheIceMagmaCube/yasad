import { sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { sessionFor } from "./auth";
import type { RunBudget } from "./checks/budget";
import { runChecks, type RunSummary } from "./checks/run";
import { type Config, loadConfig, type RawConfig } from "./config";
import type { AppEnv, Runtime } from "./context";
import type { DB } from "./db";
import { apiError } from "./errors";
import type { Outbound } from "./net/outbound";
import { about } from "./routes/about";
import { accountRoutes } from "./routes/account";
import { adminAccess } from "./routes/admin-access";
import { adminCatalog, MAX_CATALOG_BODY } from "./routes/admin-catalog";
import { adminGroups } from "./routes/admin-groups";
import { adminHistory } from "./routes/admin-history";
import { adminCategories, adminLinks } from "./routes/admin-links";
import { adminUsers } from "./routes/admin-users";
import { authRoutes } from "./routes/auth";
import { home } from "./routes/home";
import { instance } from "./routes/instance";
import { pins } from "./routes/pins";
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
  /** The target this entry runs on: "docker" for server.ts (dev included), "workers" for worker.ts. */
  runtime: Runtime;
};

/** What a scheduled run needs from its entry: the database and configuration, the outbound client and the budget. */
export type ScheduledDeps = Pick<AppDeps, "getDb" | "getRawConfig"> & {
  /** Builds the run's client from the run's counted `fetch`. */
  outbound: (fetch: typeof globalThis.fetch) => Outbound;
  budget: RunBudget;
};

/**
 * One scheduled run, the only scheduled work both entries trigger: loads the configuration and the database from
 * `env`, then runs the link checks at `now`. Logs and returns null on any error; never rejects.
 */
export async function runScheduled(env: unknown, now: number, deps: ScheduledDeps): Promise<RunSummary | null> {
  try {
    const config = loadConfig(deps.getRawConfig(env));
    return await runChecks({
      db: deps.getDb(env),
      config: config.statusChecks,
      outbound: deps.outbound,
      now,
      budget: deps.budget,
    });
  } catch (error) {
    console.error(`Status checks failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// Runtime-agnostic application.
export function createApp({ getDb, getRawConfig, getClientIp, runtime }: AppDeps) {
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
    c.set("runtime", runtime);
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
  app.route("/about", about);
  app.route("/setup", setup);
  app.route("/account", accountRoutes);
  app.route("/pins", pins);
  app.route("/admin/catalog", adminCatalog);
  app.route("/admin/categories", adminCategories);
  app.route("/admin/links", adminLinks);
  app.route("/admin/users", adminUsers);
  app.route("/admin/groups", adminGroups);
  app.route("/admin/history", adminHistory);
  app.route("/admin/access", adminAccess);
  app.route("/auth", authRoutes);

  return app;
}
