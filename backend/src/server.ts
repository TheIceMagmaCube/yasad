import { readFile } from "node:fs/promises";
import { join } from "node:path";

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
