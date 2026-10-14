// Node harness: the app on an in-memory libSQL database (Docker target).
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

import { createApp } from "../../src/app";
import type { DB } from "../../src/db";
import * as schema from "../../src/schema";

export const target = "node";

export async function request(path: string, init?: RequestInit): Promise<Response> {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return createApp(() => db as unknown as DB).request(path, init);
}
