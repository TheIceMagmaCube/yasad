import { and, asc, eq, exists, inArray, ne, sql, type SQLWrapper } from "drizzle-orm";
import { unionAll } from "drizzle-orm/sqlite-core";

import type { DB } from "./db";
import { type Icon, resolveIcon } from "./icons/resolve";
import { category, categoryGroup, group, link, linkGroup, userGroup } from "./schema";

/** Who is asking: nobody signed in, or a signed-in person with their role. */
export type Viewer = { kind: "anonymous" } | { kind: "user"; userId: string; role: "admin" | "user" };

export type HomeLink = { id: string; title: string; description: string; url: string; icon: Icon | null };
export type HomeCategory = { id: string; title: string; links: HomeLink[] };
/** Why the home page is empty, for a signed-in viewer. */
export type HomeEmpty = "catalog_empty" | "admin_no_access" | "no_groups" | "nothing_visible";

/** Return the system groups named `names`, matched by source and name, never by seeded id. */
function systemGroups(db: DB, names: string[]) {
  return db
    .select({ id: group.id })
    .from(group)
    .where(and(eq(group.source, "system"), inArray(group.name, names)));
}

/**
 * Return a subquery listing the ids of the groups the viewer holds.
 *
 * Anonymous: `@everyone`. Signed in: `@everyone`, `@authenticated` and the non-system groups of their
 * `user_group` rows (local memberships, and OIDC ones written from the verified ID token). System
 * groups always come from the session state, never from `user_group`. Groups are rows, so
 * `oidc:Developers` and `local:Developers` are distinct ids. Being a subquery, it binds a few
 * parameters whatever the number of groups (D1 refuses more than 100).
 */
export function viewerGroupIds(db: DB, viewer: Viewer): SQLWrapper {
  if (viewer.kind === "anonymous") return systemGroups(db, ["everyone"]);
  const memberships = db
    .select({ id: group.id })
    .from(userGroup)
    .innerJoin(group, eq(group.id, userGroup.groupId))
    .where(and(eq(userGroup.userId, viewer.userId), ne(group.source, "system")));
  return unionAll(systemGroups(db, ["everyone", "authenticated"]), memberships);
}

/**
 * Return the categories and links the viewer may see, in catalog order.
 *
 * Deny by default: an active link is visible only when the viewer holds a group on the link and a
 * group on its category (not necessarily the same one). Administrators follow the same rule.
 * Categories without a visible link are left out.
 */
export async function visibleCatalog(db: DB, viewer: Viewer): Promise<HomeCategory[]> {
  const ids = viewerGroupIds(db, viewer);
  const one = sql`1`;
  const rows = await db
    .select({
      categoryId: category.id,
      categoryTitle: category.title,
      id: link.id,
      title: link.title,
      description: link.description,
      url: link.url,
      icon: link.icon,
    })
    .from(category)
    .innerJoin(link, eq(link.categoryId, category.id))
    .where(
      and(
        eq(link.active, true),
        exists(db.select({ one }).from(categoryGroup).where(and(eq(categoryGroup.categoryId, category.id), inArray(categoryGroup.groupId, ids)))),
        exists(db.select({ one }).from(linkGroup).where(and(eq(linkGroup.linkId, link.id), inArray(linkGroup.groupId, ids)))),
      ),
    )
    .orderBy(asc(category.position), asc(category.id), asc(link.position), asc(link.id));

  const categories: HomeCategory[] = [];
  for (const row of rows) {
    let current = categories.at(-1);
    if (current?.id !== row.categoryId) {
      current = { id: row.categoryId, title: row.categoryTitle, links: [] };
      categories.push(current);
    }
    current.links.push({ id: row.id, title: row.title, description: row.description ?? "", url: row.url, icon: resolveIcon(row.icon) });
  }
  return categories;
}

/**
 * Return why nothing is visible, to be called only when {@link visibleCatalog} is empty.
 *
 * Anonymous viewers get null: they learn nothing about the instance. Administrators are told whether
 * the catalog has no active link or only active links they do not hold; other people whether they
 * hold any group.
 */
export async function emptyState(db: DB, viewer: Viewer): Promise<HomeEmpty | null> {
  if (viewer.kind === "anonymous") return null;
  if (viewer.role === "admin") {
    const any = await db.select({ id: link.id }).from(link).where(eq(link.active, true)).limit(1).get();
    return any ? "admin_no_access" : "catalog_empty";
  }
  const membership = await db
    .select({ id: group.id })
    .from(userGroup)
    .innerJoin(group, eq(group.id, userGroup.groupId))
    .where(and(eq(userGroup.userId, viewer.userId), ne(group.source, "system")))
    .limit(1)
    .get();
  return membership ? "nothing_visible" : "no_groups";
}
