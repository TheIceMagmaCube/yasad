import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { type Context, Hono } from "hono";

import { createApp, runScheduled } from "./app";
import { importCatalog } from "./catalog/sync";
import { DOCKER_BUDGET } from "./checks/budget";
import { forwardedClientIp } from "./client-ip";
import { type Config, ConfigError, loadConfig } from "./config";
import type { DB } from "./db";
import * as schema from "./schema";
import { ICONS_CACHE_CONTROL, withSecurityHeaders } from "./security";
import { nodeOutbound } from "./server-outbound";
import { hasLocalAdmin, SETUP_CODE_STILL_SET } from "./setup-state";

let config: Config;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  console.error(err.message);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL ?? "file:data/yasad.db";
const migrationsDir = process.env.MIGRATIONS_DIR ?? "drizzle";
const staticDir = process.env.STATIC_DIR ?? "../frontend/dist";
const port = Number(process.env.PORT ?? 3000);

// libSQL does not create missing parent directories (SQLite error 14 on a fresh clone).
// Strip the scheme by hand: new URL("file:data/x.db") would turn the relative path absolute.
if (databaseUrl.startsWith("file:")) {
  await mkdir(dirname(databaseUrl.slice("file:".length).split("?")[0]!), { recursive: true });
}

// Another process holding the file's lock (a backup, the sqlite3 shell) would otherwise fail requests at once.
const BUSY_TIMEOUT_MS = 5000;

const db = drizzle(createClient({ url: databaseUrl, timeout: BUSY_TIMEOUT_MS }), { schema });
await migrate(db, { migrationsFolder: migrationsDir });
if (config.setupCode !== null && (await hasLocalAdmin(db as unknown as DB))) console.warn(SETUP_CODE_STILL_SET);

// The catalog file is the source of truth: applied on every start, refusing to start when invalid.
if (config.catalogFile) {
  let result: Awaited<ReturnType<typeof importCatalog>>;
  try {
    result = await importCatalog(db as unknown as DB, await readFile(config.catalogFile, "utf8"), {
      dryRun: false,
      auditor: { db: db as unknown as DB, actorId: null, retentionDays: config.auditRetentionDays },
      source: "catalog_file",
    });
  } catch (err) {
    console.error(`Could not apply the catalog file ${config.catalogFile}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  if (result.status === "invalid") {
    const lines = result.errors.map((e) => `- ${e.path || "(file)"}: ${e.code}${Object.keys(e.params).length ? ` ${JSON.stringify(e.params)}` : ""}`);
    console.error(`Invalid catalog file ${config.catalogFile}:\n${lines.join("\n")}`);
    process.exit(1);
  }
  if (result.status === "changed") {
    console.error(`Could not apply the catalog file ${config.catalogFile}: the catalog changed during the import.`);
    process.exit(1);
  }
  if (result.status === "applied") {
    const { added, updated, removed } = result.diff;
    const count = (part: { categories: string[]; links: string[] }) => part.categories.length + part.links.length;
    console.log(`Catalog loaded from ${config.catalogFile}: ${count(added)} added, ${count(updated)} updated, ${count(removed)} removed.`);
  }
}

// Link checks: one run at startup, then one a minute. A tick is skipped while the previous run is still going.
const runChecksNow = () =>
  runScheduled(process.env, Date.now(), {
    getDb: () => db as unknown as DB,
    getRawConfig: () => process.env,
    outbound: () => nodeOutbound(),
    budget: DOCKER_BUDGET,
  });
let running = false;
async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await runChecksNow();
  } finally {
    // runScheduled never rejects, but one bad run must not stop every later tick.
    running = false;
  }
}
void tick();
setInterval(() => void tick(), 60_000).unref();

/** Return the client IP: from X-Forwarded-For behind TRUST_PROXY proxies, otherwise the socket address. */
function clientIp(c: Context): string {
  if (config.trustProxy > 0) {
    const forwarded = forwardedClientIp(c.req.header("x-forwarded-for"), config.trustProxy);
    if (forwarded) return forwarded;
  }
  return getConnInfo(c).remote.address ?? "unknown";
}

const server = new Hono();
server.use("*", withSecurityHeaders(() => config.publicUrl.startsWith("https://")));
server.route(
  "/",
  createApp({ getDb: () => db as unknown as DB, getRawConfig: () => process.env, getClientIp: clientIp, runtime: "docker" }),
);
server.use(
  "/*",
  serveStatic({
    root: staticDir,
    onFound: (_path, c) => {
      if (c.req.path.startsWith("/icons/")) c.header("Cache-Control", ICONS_CACHE_CONTROL);
    },
  }),
);
// Single-page app: unknown paths outside /api and /icons get index.html.
server.get("*", async (c) => {
  if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/icons/")) return c.notFound();
  try {
    return c.html(await readFile(join(staticDir, "index.html"), "utf8"));
  } catch {
    return c.text("Frontend not built", 404);
  }
});

serve({ fetch: server.fetch, port }, () => console.log(`YASAD listening on :${port}`));
