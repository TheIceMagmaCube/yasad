import { drizzle } from "drizzle-orm/d1";

import { createApp } from "./app";
import type { DB } from "./db";
import * as schema from "./schema";

type WorkerEnv = { DB: D1Database };

export default createApp((env) => drizzle((env as WorkerEnv).DB, { schema }) as unknown as DB);
