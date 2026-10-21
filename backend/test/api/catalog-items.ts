import { type TestApp, testApp } from "#harness";
import { expect } from "vitest";

import { addUser, post, signIn } from "./users";

export type Link = {
  id: string;
  categoryId: string;
  title: string;
  description: string;
  url: string;
  icon: string | null;
  iconKnown: boolean;
  keywords: string[];
  active: boolean;
  check: boolean;
  status: Record<string, unknown> | null;
  groups: string[];
  revision: number;
};
export type Category = { id: string; title: string; groups: string[]; revision: number; links: Link[] };
export type ApiError = { code: string; fields?: Record<string, string>; current?: Record<string, unknown>; linkCount?: number };

/** Return a client signed in as an administrator, on a fresh database. */
export async function adminApp(env = {}): Promise<TestApp> {
  const app = await testApp(env);
  await addUser(app, { id: "ada", email: "ada@example.invalid", role: "admin" });
  expect((await signIn(app, "ada@example.invalid")).status).toBe(200);
  return app;
}

/** Return the catalog as the admin screen reads it. */
export async function adminCatalog(app: TestApp): Promise<Category[]> {
  const res = await app.request("/api/admin/categories");
  expect(res.status).toBe(200);
  return ((await res.json()) as { categories: Category[] }).categories;
}

/** Create a category open to everyone unless `groups` says otherwise. */
export async function newCategory(app: TestApp, body: Record<string, unknown>): Promise<Category> {
  const res = await post(app, "/api/admin/categories", { groups: ["@everyone"], ...body });
  expect(res.status).toBe(201);
  return ((await res.json()) as { category: Category }).category;
}

/** Create a link open to everyone unless `groups` says otherwise. */
export async function newLink(app: TestApp, body: Record<string, unknown>): Promise<Link> {
  const res = await post(app, "/api/admin/links", { url: "https://example.org", groups: ["@everyone"], ...body });
  expect(res.status).toBe(201);
  return ((await res.json()) as { link: Link }).link;
}

export const errorOf = async (res: Response) => ((await res.json()) as { error: ApiError }).error;

/** Return the stored positions of the categories, or of the links of one category, in (position, id) order. */
export async function positions(app: TestApp, categoryId?: string): Promise<[string, number][]> {
  const sql = categoryId
    ? `select id, position from link where category_id = '${categoryId}' order by position, id`
    : "select id, position from category order by position, id";
  return (await app.query(sql)).map((row) => [row.id as string, Number(row.position)]);
}

/** Import a catalog file as the admin page does: preview, then apply with its baseVersion. */
export async function importFile(app: TestApp, yaml: string) {
  const preview = await post(app, "/api/admin/catalog", { yaml, dryRun: true });
  expect(preview.status).toBe(200);
  const { baseVersion } = (await preview.json()) as { baseVersion: string };
  const applied = await post(app, "/api/admin/catalog", { yaml, dryRun: false, baseVersion });
  expect(applied.status).toBe(200);
}
