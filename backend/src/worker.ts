import { drizzle } from "drizzle-orm/d1";

import { createApp, runScheduled } from "./app";
import { WORKERS_BUDGET } from "./checks/budget";
import type { RawConfig } from "./config";
import type { DB } from "./db";
import { fetchOutbound } from "./net/fetch-outbound";
import * as schema from "./schema";

type WorkerEnv = RawConfig & { DB: D1Database };

const deps = {
  getDb: (env: unknown) => drizzle((env as WorkerEnv).DB, { schema }) as unknown as DB,
  getRawConfig: (env: unknown) => env as RawConfig,
};
const app = createApp({ ...deps, getClientIp: (c) => c.req.header("cf-connecting-ip") ?? "unknown", runtime: "workers" });

export default {
  fetch: app.fetch,
  /** The cron trigger: one run of the link checks, under the Workers budget. */
  scheduled(controller: ScheduledController, env: unknown, ctx: ExecutionContext) {
    ctx.waitUntil(
      runScheduled(env, controller.scheduledTime, {
        ...deps,
        outbound: (fetch) => fetchOutbound({ fetch }),
        budget: WORKERS_BUDGET,
      }),
    );
  },
} satisfies ExportedHandler<WorkerEnv>;
