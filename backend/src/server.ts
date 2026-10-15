import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { Hono } from "hono";

import { createApp } from "./app";
import type { DB } from "./db";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL ?? "file:data/yasad.db";
const migrationsDir = process.env.MIGRATIONS_DIR ?? "drizzle";
const staticDir = process.env.STATIC_DIR ?? "../frontend/dist";
const port = Number(process.env.PORT ?? 3000);

// libSQL does not create missing parent directories (SQLite error 14 on a fresh clone).
// Strip the scheme by hand: new URL("file:data/x.db") would turn the relative path absolute.
if (databaseUrl.startsWith("file:")) {
  await mkdir(dirname(databaseUrl.slice("file:".length).split("?")[0]!), { recursive: true });
}

const db = drizzle(createClient({ url: databaseUrl }), { schema });
await migrate(db, { migrationsFolder: migrationsDir });

const server = new Hono();
server.route("/", createApp(() => db as unknown as DB));
server.use("/*", serveStatic({ root: staticDir }));
// Single-page app: unknown paths outside /api get index.html.
server.get("*", async (c) => {
  if (c.req.path.startsWith("/api/")) return c.notFound();
  try {
    return c.html(await readFile(join(staticDir, "index.html"), "utf8"));
  } catch {
    return c.text("Frontend not built", 404);
  }
});

serve({ fetch: server.fetch, port }, () => console.log(`YASAD listening on :${port}`));
