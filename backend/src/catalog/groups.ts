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

/** Return each set of references that differ only by case, sorted, among `refs`. */
export function caseVariants(refs: Iterable<string>): string[][] {
  const byLowerCase = new Map<string, Set<string>>();
  for (const ref of refs) {
    const key = ref.toLowerCase();
    byLowerCase.set(key, (byLowerCase.get(key) ?? new Set()).add(ref));
  }
  return [...byLowerCase.values()].filter((variants) => variants.size > 1).map((variants) => [...variants].sort());
}

/** Return the statement creating the group unless it exists; usable in db.batch. */
export function insertGroupIfMissing(db: DB, { source, name }: GroupKey) {
  return db
    .insert(group)
    .values({ id: crypto.randomUUID(), source, name })
    .onConflictDoNothing({ target: [group.source, group.name] });
}
