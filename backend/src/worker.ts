import { drizzle } from "drizzle-orm/d1";

import { createApp } from "./app";
import type { RawConfig } from "./config";
import type { DB } from "./db";
import * as schema from "./schema";

type WorkerEnv = RawConfig & { DB: D1Database };

export default createApp({
  getDb: (env) => drizzle((env as WorkerEnv).DB, { schema }) as unknown as DB,
  getRawConfig: (env) => env as RawConfig,
  getClientIp: (c) => c.req.header("cf-connecting-ip") ?? "unknown",
  runtime: "workers",
});
