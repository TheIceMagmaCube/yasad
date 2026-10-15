import { and, eq } from "drizzle-orm";

import type { DB } from "../db";
import { group } from "../schema";

export type GroupSource = "oidc" | "local" | "system";
export type GroupKey = { source: GroupSource; name: string };

/** Return the group a catalog reference names: `@everyone`, `@authenticated`, `oidc:<name>` or `local:<name>`. */
export function parseGroupRef(ref: string): GroupKey {
  if (ref.startsWith("@")) return { source: "system", name: ref.slice(1) };
  const colon = ref.indexOf(":");
  return { source: ref.slice(0, colon) as GroupSource, name: ref.slice(colon + 1).trim() };
}

/** Return the catalog reference of a group. */
export function groupRef({ source, name }: GroupKey): string {
  return source === "system" ? `@${name}` : `${source}:${name}`;
}

/** Return the statement creating the group unless it exists; usable in db.batch. */
export function insertGroupIfMissing(db: DB, { source, name }: GroupKey) {
  return db
    .insert(group)
    .values({ id: crypto.randomUUID(), source, name })
    .onConflictDoNothing({ target: [group.source, group.name] });
}

/**
 * Return the id of the group, creating it when it does not exist yet.
 *
 * The catalog import and the OIDC sign-in both go through the (source, name) pair, so a group
 * created by an import is the one its members get at their first sign-in.
 */
export async function findOrCreateGroup(db: DB, key: GroupKey): Promise<string> {
  await insertGroupIfMissing(db, key);
  const row = await db
    .select({ id: group.id })
    .from(group)
    .where(and(eq(group.source, key.source), eq(group.name, key.name)))
    .get();
  return row!.id;
}
