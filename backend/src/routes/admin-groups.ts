import { and, asc, count, eq } from "drizzle-orm";
import { type Context, Hono } from "hono";

import { bumpRevision } from "../catalog/sync";
import type { AppEnv } from "../context";
import type { DB } from "../db";
import { apiError } from "../errors";
import { categoryGroup, group, linkGroup, user, userGroup } from "../schema";
import { requireAdmin } from "./require-admin";

export type AdminGroup = {
  id: string;
  name: string;
  source: "oidc" | "local" | "system";
  memberIds: string[];
  /** How many catalog categories and links the group opens, shown before deleting it. */
  categories: number;
  links: number;
};

async function readJson(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  return body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

/** Return every group with its members and catalog use, system groups first, then by name. */
async function listGroups(db: DB): Promise<AdminGroup[]> {
  const [groups, members, categories, links] = await Promise.all([
    db.select().from(group).orderBy(asc(group.name)),
    db.select().from(userGroup),
    db.select({ groupId: categoryGroup.groupId, n: count() }).from(categoryGroup).groupBy(categoryGroup.groupId),
    db.select({ groupId: linkGroup.groupId, n: count() }).from(linkGroup).groupBy(linkGroup.groupId),
  ]);
  const countOf = (rows: { groupId: string; n: number }[], id: string) => rows.find((r) => r.groupId === id)?.n ?? 0;
  const order = { system: 0, local: 1, oidc: 2 };
  return groups
    .map((g) => ({
      id: g.id,
      name: g.name,
      source: g.source,
      memberIds: members.filter((m) => m.groupId === g.id).map((m) => m.userId),
      categories: countOf(categories, g.id),
      links: countOf(links, g.id),
    }))
    .sort((a, b) => order[a.source] - order[b.source]);
}

/** Return the trimmed name, or null when it cannot name a group (1 to 100 characters). */
function parseName(value: unknown): string | null {
  const name = typeof value === "string" ? value.trim() : "";
  return name.length > 0 && name.length <= 100 ? name : null;
}

/** Return the local group, or the response refusing to change it: 404 when missing, 409 for OIDC and system groups. */
async function localGroup(c: Context<AppEnv>): Promise<{ id: string; name: string } | Response> {
  const row = await c.var.db.select().from(group).where(eq(group.id, c.req.param("id")!)).get();
  if (!row) return apiError(c, 404, "not_found", "No such group.");
  if (row.source !== "local") return apiError(c, 409, "read_only_group", "Only local groups can be changed in YASAD.");
  return row;
}

const nameTaken = async (db: DB, name: string) =>
  (await db.select({ id: group.id }).from(group).where(and(eq(group.source, "local"), eq(group.name, name))).get()) !== undefined;

export const adminGroups = new Hono<AppEnv>();

adminGroups.use("*", requireAdmin);

adminGroups.get("/", async (c) => c.json({ groups: await listGroups(c.var.db) }));

adminGroups.post("/", async (c) => {
  const { db } = c.var;
  const name = parseName((await readJson(c)).name);
  if (name === null) return apiError(c, 422, "invalid_input", "Some fields are not valid.", { fields: { name: "invalid_name" } });
  const taken = () => apiError(c, 422, "invalid_input", "Some fields are not valid.", { fields: { name: "name_taken" } });
  if (await nameTaken(db, name)) return taken();
  const id = crypto.randomUUID();
  try {
    await db.insert(group).values({ id, name, source: "local" });
  } catch (err) {
    if (await nameTaken(db, name)) return taken();
    throw err;
  }
  return c.json({ group: (await listGroups(db)).find((g) => g.id === id) }, 201);
});

/** Rename a local group; the catalog keeps pointing at it, under its new name. */
adminGroups.patch("/:id", async (c) => {
  const { db } = c.var;
  const target = await localGroup(c);
  if (target instanceof Response) return target;
  const name = parseName((await readJson(c)).name);
  if (name === null) return apiError(c, 422, "invalid_input", "Some fields are not valid.", { fields: { name: "invalid_name" } });
  if (name === target.name) return c.json({ group: (await listGroups(db)).find((g) => g.id === target.id) });
  const taken = () => apiError(c, 422, "invalid_input", "Some fields are not valid.", { fields: { name: "name_taken" } });
  if (await nameTaken(db, name)) return taken();
  try {
    await db.batch([db.update(group).set({ name }).where(eq(group.id, target.id)), bumpRevision(db)]);
  } catch (err) {
    if (await nameTaken(db, name)) return taken();
    throw err;
  }
  return c.json({ group: (await listGroups(db)).find((g) => g.id === target.id) });
});

/** Delete a local group; its memberships and its place in the catalog cascade. */
adminGroups.delete("/:id", async (c) => {
  const { db } = c.var;
  const target = await localGroup(c);
  if (target instanceof Response) return target;
  await db.batch([db.delete(group).where(eq(group.id, target.id)), bumpRevision(db)]);
  return c.body(null, 204);
});

adminGroups.put("/:id/members/:userId", async (c) => {
  const { db } = c.var;
  const target = await localGroup(c);
  if (target instanceof Response) return target;
  const userId = c.req.param("userId");
  if (!(await db.select({ id: user.id }).from(user).where(eq(user.id, userId)).get())) return apiError(c, 404, "not_found", "No such user.");
  await db.insert(userGroup).values({ userId, groupId: target.id }).onConflictDoNothing();
  return c.body(null, 204);
});

adminGroups.delete("/:id/members/:userId", async (c) => {
  const target = await localGroup(c);
  if (target instanceof Response) return target;
  await c.var.db.delete(userGroup).where(and(eq(userGroup.groupId, target.id), eq(userGroup.userId, c.req.param("userId"))));
  return c.body(null, 204);
});
