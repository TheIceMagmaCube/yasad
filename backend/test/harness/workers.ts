// Workers harness: the real Worker entry, running in workerd with a local D1 database.
import { env } from "cloudflare:workers";

import worker from "../../src/worker";
import { BASE_ENV, client, type TestApp, type TestEnv } from "./shared";

export { BASE_ENV, TEST_IP } from "./shared";
export const target = "workers";

const TABLES = ["session", "account", "verification", "user", "setting", "rate_limit"];

/** Return a client on the D1 database, emptied first. */
export async function testApp(overrides: TestEnv = {}): Promise<TestApp> {
  await env.DB.batch(TABLES.map((table) => env.DB.prepare(`delete from "${table}"`)));
  const bindings = { DB: env.DB, ...BASE_ENV, ...overrides };
  return client(
    async (req) => worker.fetch(req, bindings),
    async (sql) => {
      await env.DB.prepare(sql).run();
    },
    async (sql) => (await env.DB.prepare(sql).all<Record<string, unknown>>()).results,
  );
}

export async function request(path: string, init?: RequestInit): Promise<Response> {
  return (await testApp()).request(path, init);
}
