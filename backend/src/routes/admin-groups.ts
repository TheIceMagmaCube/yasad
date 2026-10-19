import { and, asc, count, eq, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";

import { auditStatements, readSnapshot, retrying, snapshot, unchangedSince } from "../audit";
import { bumpRevision } from "../catalog/sync";
import type { AppEnv } from "../context";
import type { DB } from "../db";
import { apiError } from "../errors";
import { categoryGroup, group, linkGroup, user, userGroup } from "../schema";
import { readJson } from "./body";
import { auditorOf, requireAdmin } from "./require-admin";

export type AdminGroup = {
  id: string;
  name: string;
  source: "oidc" | "local" | "system";
  memberIds: string[];
  /** Last sign-in whose token named this OIDC group, or null when the provider never sent it. */
  seenAt: string | null;
  /** How many catalog categories and links the group opens, shown before deleting it. */
  categories: number;
  links: number;
};

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
      seenAt: g.seenAt?.toISOString() ?? null,
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

/**
 * Return whether another local group has this name, ignoring case: the catalog would tell them apart only by case.
 *
 * Compared in JavaScript: SQLite's lower() folds ASCII letters only, so "Équipe" would not match itself.
 */
async function nameTaken(db: DB, name: string, exceptId?: string): Promise<boolean> {
  const key = name.toLowerCase();
  const local = await db.select({ id: group.id, name: group.name }).from(group).where(eq(group.source, "local"));
  return local.some((g) => g.id !== exceptId && g.name.toLowerCase() === key);
}

/**
 * Return the 409 refusing to rename or delete a group the catalog uses while CATALOG_FILE manages it.
 *
 * The file names its groups: at the next start it would bring the old name back, empty, and move the links to it.
 */
async function usedByCatalogFile(c: Context<AppEnv>, id: string): Promise<Response | null> {
  if (!c.var.config.catalogFile) return null;
  const { db } = c.var;
  const [inCategory, inLink] = await Promise.all([
    db.select({ id: categoryGroup.groupId }).from(categoryGroup).where(eq(categoryGroup.groupId, id)).get(),
    db.select({ id: linkGroup.groupId }).from(linkGroup).where(eq(linkGroup.groupId, id)).get(),
  ]);
  if (!inCategory && !inLink) return null;
  return apiError(c, 409, "catalog_managed_by_file", "CATALOG_FILE uses this group; change that file first.");
}

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
    await db.batch([
      db.insert(group).values({ id, name, source: "local" }),
      ...auditStatements(await auditorOf(c), { action: "create", type: "group", id, before: null, after: snapshot.group(id) }),
    ]);
  } catch (err) {
    if (await nameTaken(db, name)) return taken();
    throw err;
  }
  return c.json({ group: (await listGroups(db)).find((g) => g.id === id) }, 201);
});

/** Rename a local group; the catalog keeps pointing at it, under its new name. */
adminGroups.patch("/:id", async (c) => {
  const { db } = c.var;
  const auditor = await auditorOf(c);
  const body = await readJson(c);
  return retrying(async (last) => {
    const target = await localGroup(c);
    if (target instanceof Response) return target;
    const refused = await usedByCatalogFile(c, target.id);
    if (refused) return refused;
    const name = parseName(body.name);
    if (name === null) return apiError(c, 422, "invalid_input", "Some fields are not valid.", { fields: { name: "invalid_name" } });
    if (name === target.name) return c.json({ group: (await listGroups(db)).find((g) => g.id === target.id) });
    const taken = () => apiError(c, 422, "invalid_input", "Some fields are not valid.", { fields: { name: "name_taken" } });
    if (await nameTaken(db, name, target.id)) return taken();
    const current = snapshot.group(target.id);
    const before = await readSnapshot(db, current);
    try {
      await db.batch([
        unchangedSince(db, current, before),
        db.update(group).set({ name }).where(eq(group.id, target.id)),
        bumpRevision(db),
        ...auditStatements(auditor, { action: "update", type: "group", id: target.id, before, after: current }),
      ]);
    } catch (err) {
      if (await nameTaken(db, name, target.id)) return taken();
      if (!last && (await readSnapshot(db, current)) !== before) return "retry";
      throw err;
    }
    return c.json({ group: (await listGroups(db)).find((g) => g.id === target.id) });
  });
});

/** Delete a local group; its memberships and its place in the catalog cascade. */
adminGroups.delete("/:id", async (c) => {
  const { db } = c.var;
  const auditor = await auditorOf(c);
  return retrying(async (last) => {
    const target = await localGroup(c);
    if (target instanceof Response) return target;
    const refused = await usedByCatalogFile(c, target.id);
    if (refused) return refused;
    const current = snapshot.deletedGroup(target.id);
    const before = await readSnapshot(db, current);
    try {
      await db.batch([
        unchangedSince(db, current, before),
        db.delete(group).where(eq(group.id, target.id)),
        bumpRevision(db),
        ...auditStatements(auditor, { action: "delete", type: "group", id: target.id, before, after: null }),
      ]);
    } catch (err) {
      if (!last && (await readSnapshot(db, current)) !== before) return "retry";
      throw err;
    }
    return c.body(null, 204);
  });
});

/**
 * Return the audit entry of a membership change, written only when the membership changes: the entry
 * goes before the write in the batch, with the same condition.
 */
function memberEntry(groupId: string, userId: string, adds: boolean) {
  const member = sql`exists (select 1 from user_group where user_id = ${userId} and group_id = ${groupId})`;
  return {
    action: adds ? "member_add" : "member_remove",
    type: "group",
    id: groupId,
    label: sql`(select name from "group" where id = ${groupId})`,
    related: { type: "user", id: userId, label: sql`(select name from "user" where id = ${userId})` },
    before: null,
    after: null,
    when: adds ? sql`not ${member}` : member,
  } as const;
}

adminGroups.put("/:id/members/:userId", async (c) => {
  const { db } = c.var;
  const target = await localGroup(c);
  if (target instanceof Response) return target;
  const userId = c.req.param("userId");
  if (!(await db.select({ id: user.id }).from(user).where(eq(user.id, userId)).get())) return apiError(c, 404, "not_found", "No such user.");
  await db.batch([
    ...auditStatements(await auditorOf(c), memberEntry(target.id, userId, true)),
    db.insert(userGroup).values({ userId, groupId: target.id }).onConflictDoNothing(),
  ]);
  return c.body(null, 204);
});

adminGroups.delete("/:id/members/:userId", async (c) => {
  const { db } = c.var;
  const target = await localGroup(c);
  if (target instanceof Response) return target;
  const userId = c.req.param("userId");
  await db.batch([
    ...auditStatements(await auditorOf(c), memberEntry(target.id, userId, false)),
    db.delete(userGroup).where(and(eq(userGroup.groupId, target.id), eq(userGroup.userId, userId))),
  ]);
  return c.body(null, 204);
});
