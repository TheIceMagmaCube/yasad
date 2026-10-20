import type { TestApp } from "#harness";
import { expect } from "vitest";

import { addUser, send, signIn } from "./users";

export type LinkSpec = { id: string; groups: string[]; title?: string; description?: string; icon?: string; active?: boolean; keywords?: string[] };
export type CategorySpec = { id: string; groups: string[]; links: LinkSpec[] };

/** Return a catalog file (JSON is valid YAML) with a title and URL derived from each id. */
export function catalog(categories: CategorySpec[]): string {
  return JSON.stringify({
    version: 1,
    categories: categories.map((cat) => ({
      id: cat.id,
      title: `Category ${cat.id}`,
      groups: cat.groups,
      links: cat.links.map(({ id, title, ...rest }) => ({ id, title: title ?? `Link ${id}`, url: `https://${id}.example.invalid/`, ...rest })),
    })),
  });
}

/** Return a second browser signed in as a new local user. */
export async function localUser(admin: TestApp, id: string, role: "admin" | "user" = "user"): Promise<TestApp> {
  const browser = admin.another();
  await addUser(browser, { id, email: `${id}@example.invalid`, role });
  expect((await signIn(browser, `${id}@example.invalid`)).status).toBe(200);
  return browser;
}

/** Return the id of a group, by source and name. */
export async function groupId(app: TestApp, source: string, name: string): Promise<string> {
  const rows = await app.query(`select id from "group" where source = '${source}' and name = '${name}'`);
  expect(rows).toHaveLength(1);
  return rows[0]!.id as string;
}

/** Add a membership row directly, as the OIDC sign-in hook will. */
export async function addMembership(app: TestApp, userId: string, source: string, name: string) {
  await app.exec(`insert into user_group (user_id, group_id) select '${userId}', id from "group" where source = '${source}' and name = '${name}'`);
}

/** Put a user in a local group through the admin API. */
export async function join(admin: TestApp, userId: string, name: string) {
  expect((await send(admin, "PUT", `/api/admin/groups/${await groupId(admin, "local", name)}/members/${userId}`)).status).toBe(204);
}
