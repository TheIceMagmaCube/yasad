import type { TestApp } from "#harness";
import { expect } from "vitest";

import { addUser, send, signIn } from "./users";

export type LinkSpec = { id: string; groups: string[]; title?: string; description?: string; icon?: string; active?: boolean; keywords?: string[]; check?: boolean };
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

/** Return the source and name of a catalog group reference: `@everyone`, `local:Ops`, `oidc:Dev`. */
function groupRef(ref: string): { source: string; name: string } {
  if (ref.startsWith("@")) return { source: "system", name: ref.slice(1) };
  const colon = ref.indexOf(":");
  return { source: ref.slice(0, colon), name: ref.slice(colon + 1) };
}

/**
 * Write a catalog straight into the database in one batch, as {@link catalog} describes it. Used where the
 * import and the admin writes are refused, under CATALOG_FILE.
 */
export async function seedCatalogSql(app: TestApp, categories: CategorySpec[]) {
  const statements: string[] = [];
  const grant = (table: "category_group" | "link_group", column: string, id: string, refs: string[]) => {
    for (const ref of refs) {
      const { source, name } = groupRef(ref);
      statements.push(`insert or ignore into "group" (id, name, source) values ('${source}:${name}', '${name}', '${source}')`);
      statements.push(`insert into ${table} (${column}, group_id) select '${id}', id from "group" where source = '${source}' and name = '${name}'`);
    }
  };
  categories.forEach((cat, position) => {
    statements.push(`insert into category (id, title, position) values ('${cat.id}', 'Category ${cat.id}', ${position})`);
    grant("category_group", "category_id", cat.id, cat.groups);
    cat.links.forEach((lnk, rank) => {
      statements.push(
        `insert into link (id, category_id, title, url, position, active) values ('${lnk.id}', '${cat.id}', '${lnk.title ?? `Link ${lnk.id}`}', 'https://${lnk.id}.example.invalid/', ${rank}, ${lnk.active === false ? 0 : 1})`,
      );
      grant("link_group", "link_id", lnk.id, lnk.groups);
    });
  });
  await app.batch(statements);
}
