// Workers harness: the real Worker entry, running in workerd with a local D1 database.
import { env } from "cloudflare:workers";

import worker from "../../src/worker";
import { BASE_ENV, client, type TestApp, type TestEnv } from "./shared";

export { BASE_ENV, TEST_IP } from "./shared";
export const target = "workers";

const TABLES = ["user_group", "link_group", "category_group", "link", "category", "session", "account", "verification", "user", "setting", "rate_limit"];

/** Return a client on the D1 database, emptied first. */
export async function testApp(overrides: TestEnv = {}): Promise<TestApp> {
  // The audit log refuses to lose recent entries: its trigger is taken from the migration, dropped while
  // the table is emptied, then created again.
  const trigger = await env.DB.prepare("select sql from sqlite_master where type = 'trigger' and name = 'audit_log_keep_recent'").first<{ sql: string }>();
  await env.DB.batch([
    ...TABLES.map((table) => env.DB.prepare(`delete from "${table}"`)),
    env.DB.prepare("drop trigger audit_log_keep_recent"),
    env.DB.prepare("delete from audit_log"),
    env.DB.prepare(trigger!.sql),
    // System groups come from a migration and must survive the reset.
    env.DB.prepare(`delete from "group" where source <> 'system'`),
  ]);
  const bindings = { DB: env.DB, ...BASE_ENV, ...overrides };
  return client(
    async (req) => worker.fetch(req, bindings),
    async (sql) => {
      await env.DB.prepare(sql).run();
    },
    async (sql) => (await env.DB.prepare(sql).all<Record<string, unknown>>()).results,
    async (sqls) => {
      await env.DB.batch(sqls.map((sql) => env.DB.prepare(sql)));
    },
  );
}

export async function request(path: string, init?: RequestInit): Promise<Response> {
  return (await testApp()).request(path, init);
}
