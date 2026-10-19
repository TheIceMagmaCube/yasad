import type { TestApp } from "#harness";
import { expect } from "vitest";

export type Entry = {
  id: number;
  at: string;
  actor: { id: string; name: string; email: string; exists: boolean } | null;
  action: string;
  object: { type: string; id: string | null; label: string | null; exists: boolean };
  related: { type: string; id: string; label: string; exists: boolean } | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  details: Record<string, unknown> | null;
};

/** Return one page of the history as an admin reads it, with the cursor to the next one. */
export async function historyPage(app: TestApp, query = ""): Promise<{ entries: Entry[]; next: number | null }> {
  const res = await app.request(`/api/admin/history${query ? `?${query}` : ""}`);
  expect(res.status).toBe(200);
  return (await res.json()) as { entries: Entry[]; next: number | null };
}

/** Return the entries, newest first. */
export const history = async (app: TestApp, query = "") => (await historyPage(app, query)).entries;

/** Return the number of rows in the audit log, expired ones included. */
export const auditCount = async (app: TestApp) => Number((await app.query("select count(*) as n from audit_log"))[0]!.n);

/** Insert an entry straight into the log, `daysAgo` days old. */
export async function oldEntry(app: TestApp, daysAgo: number, fields: { actor?: string; type?: string; object?: string } = {}) {
  const at = Date.now() - daysAgo * 86_400_000;
  const actor = fields.actor ? `'${fields.actor}'` : "null";
  const object = fields.object ? `'${fields.object}'` : "null";
  await app.exec(
    `insert into audit_log (at, actor_id, actor_name, action, object_type, object_id) values (${at}, ${actor}, ${actor}, 'update', '${fields.type ?? "link"}', ${object})`,
  );
}
