import { and, asc, count, eq, exists, inArray, ne, type SQL, sql, type SQLWrapper } from "drizzle-orm";
import { unionAll } from "drizzle-orm/sqlite-core";

import { parseKeywords } from "./catalog/format";
import { ownStatus, type PublicStatus, publicStatus } from "./checks/status";
import type { DB } from "./db";
import { type Icon, resolveIcon } from "./icons/resolve";
import { category, categoryGroup, group, link, linkGroup, linkStatus, user, userGroup, userLinkPin } from "./schema";

/** Who is asking: nobody signed in, or a signed-in person with their role. */
export type Viewer = { kind: "anonymous" } | { kind: "user"; userId: string; role: "admin" | "user" };
/** A signed-in viewer. */
export type UserViewer = Extract<Viewer, { kind: "user" }>;

/**
 * A visible link as sent to the browser. `keywords` are sent as stored, for the search in the header. `status` is
 * set only when the server checks the link.
 */
export type HomeLink = {
  id: string;
  title: string;
  description: string;
  url: string;
  icon: Icon | null;
  keywords: string[];
  status?: PublicStatus;
};
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
 * Return the non-system groups of a person's `user_group` rows, for `userId` given as a value or as a
 * column of an outer query.
 */
function memberGroupIds(db: DB, userId: string | SQLWrapper) {
  return db
    .select({ id: group.id })
    .from(userGroup)
    .innerJoin(group, eq(group.id, userGroup.groupId))
    .where(and(eq(userGroup.userId, userId), ne(group.source, "system")));
}

/** Return the ids of the groups a signed-in person holds, for `userId` given as a value or as a column. */
function signedInGroupIds(db: DB, userId: string | SQLWrapper): SQLWrapper {
  return unionAll(systemGroups(db, ["everyone", "authenticated"]), memberGroupIds(db, userId));
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
  return signedInGroupIds(db, viewer.userId);
}

/** A group the viewer holds, as shown to them: name and origin, no id. */
export type ViewerGroup = { name: string; source: "system" | "local" | "oidc" };

/**
 * Return the groups the viewer holds, by name then id: exactly {@link viewerGroupIds}, so what is shown is what
 * opens links. A subquery: a few parameters whatever the number of groups.
 */
export function viewerGroups(db: DB, viewer: Viewer): Promise<ViewerGroup[]> {
  return db
    .select({ name: group.name, source: group.source })
    .from(group)
    .where(inArray(group.id, viewerGroupIds(db, viewer)))
    .orderBy(asc(group.name), asc(group.id));
}

/** The three conditions of the access rule, over the `link` and `category` columns of a query joining both. */
type AccessParts = { active: SQL; category: SQL; link: SQL };

/**
 * Return the conditions of the access rule for the holder of the groups `ids`: the link is active, a group of
 * `ids` is on the category, a group of `ids` is on the link.
 */
function accessParts(db: DB, ids: SQLWrapper): AccessParts {
  const one = sql`1`;
  return {
    active: eq(link.active, true),
    category: exists(db.select({ one }).from(categoryGroup).where(and(eq(categoryGroup.categoryId, category.id), inArray(categoryGroup.groupId, ids)))),
    link: exists(db.select({ one }).from(linkGroup).where(and(eq(linkGroup.linkId, link.id), inArray(linkGroup.groupId, ids)))),
  };
}

/** Return the condition under which all of the access rule holds. */
function allOf(parts: AccessParts): SQL {
  return and(parts.active, parts.category, parts.link) as SQL;
}

/**
 * Return the condition under which the viewer may see a link, over the `link` and `category` columns
 * of a query joining both.
 *
 * Deny by default: the link is active, and the viewer holds a group on the link and a group on its
 * category (not necessarily the same one). Administrators follow the same rule. Every read or guard
 * on a link's visibility goes through this condition.
 */
export function linkVisibleWhere(db: DB, viewer: Viewer): SQL {
  return allOf(accessParts(db, viewerGroupIds(db, viewer)));
}

/**
 * Return an `exists` condition, usable without a FROM, that holds when the link `linkId` exists and the
 * viewer may see it. A missing, inactive or forbidden link all give false.
 */
export function visibleLink(db: DB, viewer: Viewer, linkId: string): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(link)
      .innerJoin(category, eq(category.id, link.categoryId))
      .where(and(eq(link.id, linkId), linkVisibleWhere(db, viewer))),
  );
}

/**
 * Return the ids of the viewer's pinned links they may see, in pin order `(position, link_id)`.
 *
 * Anonymous viewers get `[]`. A hidden pin (link inactive, or access lost) keeps its row but never
 * comes out of this function.
 */
export async function visiblePins(db: DB, viewer: Viewer): Promise<string[]> {
  if (viewer.kind === "anonymous") return [];
  const rows = await db
    .select({ id: userLinkPin.linkId })
    .from(userLinkPin)
    .innerJoin(link, eq(link.id, userLinkPin.linkId))
    .innerJoin(category, eq(category.id, link.categoryId))
    .where(and(eq(userLinkPin.userId, viewer.userId), linkVisibleWhere(db, viewer)))
    .orderBy(asc(userLinkPin.position), asc(userLinkPin.linkId));
  return rows.map((row) => row.id);
}

/**
 * Return a scalar subquery counting the viewer's visible pins, for the guard on the cap. Hidden pins
 * are not counted, as in {@link visiblePins}.
 */
export function visiblePinCount(db: DB, viewer: UserViewer): SQL {
  const count = db
    .select({ count: sql`count(*)` })
    .from(userLinkPin)
    .innerJoin(link, eq(link.id, userLinkPin.linkId))
    .innerJoin(category, eq(category.id, link.categoryId))
    .where(and(eq(userLinkPin.userId, viewer.userId), linkVisibleWhere(db, viewer)));
  return sql`${count}`;
}

/**
 * Return the categories and links the viewer may see, in catalog order.
 *
 * Deny by default: an active link is visible only when the viewer holds a group on the link and a
 * group on its category (not necessarily the same one). Administrators follow the same rule.
 * Categories without a visible link are left out. A checked link carries its stored result, read in the same
 * query so it follows the same condition, as {@link publicStatus} computes it at `checks.now`.
 */
export async function visibleCatalog(
  db: DB,
  viewer: Viewer,
  checks: { now: number; intervalMinutes: number },
): Promise<HomeCategory[]> {
  const rows = await db
    .select({
      categoryId: category.id,
      categoryTitle: category.title,
      id: link.id,
      title: link.title,
      description: link.description,
      url: link.url,
      icon: link.icon,
      keywords: link.keywords,
      check: link.check,
      state: linkStatus.state,
      checkedAt: linkStatus.checkedAt,
    })
    .from(category)
    .innerJoin(link, eq(link.categoryId, category.id))
    .leftJoin(linkStatus, ownStatus)
    .where(linkVisibleWhere(db, viewer))
    .orderBy(asc(category.position), asc(category.id), asc(link.position), asc(link.id));

  const categories: HomeCategory[] = [];
  for (const row of rows) {
    let current = categories.at(-1);
    if (current?.id !== row.categoryId) {
      current = { id: row.categoryId, title: row.categoryTitle, links: [] };
      categories.push(current);
    }
    current.links.push({
      id: row.id, title: row.title, description: row.description ?? "", url: row.url, icon: resolveIcon(row.icon),
      keywords: parseKeywords(row.keywords),
      ...(row.check ? { status: publicStatus(row, checks.now, checks.intervalMinutes) } : {}),
    });
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
  const membership = await memberGroupIds(db, viewer.userId).limit(1).get();
  return membership ? "nothing_visible" : "no_groups";
}

/** Why a viewer does not see a link, in the order an administrator fixes them. */
export type AccessReasonCode = "link_inactive" | "link_no_group" | "category_no_group" | "missing_link_group" | "missing_category_group";
/** A group as named in an explanation. */
export type NamedGroup = { id: string; name: string; source: "system" | "local" | "oidc" };
/**
 * A held group that looks like an expected one without being it: same name from another source, or the same
 * name but for case. It helps reading only: it never opens the link.
 */
export type AccessHint = { kind: "other_source" | "other_case"; held: NamedGroup; expected: NamedGroup };
export type AccessReason = { code: AccessReasonCode; hint?: AccessHint };
/** Whether a viewer sees a link, and every reason when they do not. `pinned` is set when they pinned it. */
export type LinkExplanation = {
  id: string;
  title: string;
  categoryId: string;
  categoryTitle: string;
  visible: boolean;
  reasons: AccessReason[];
  pinned?: true;
};

/**
 * Return a held group that looks like one of `expected`: the same name from another source first, else the same
 * name but for case. A held system group never counts.
 */
function hintFor(held: NamedGroup[], expected: NamedGroup[]): AccessHint | undefined {
  const own = held.filter((g) => g.source !== "system");
  for (const kind of ["other_source", "other_case"] as const) {
    for (const want of expected) {
      const match = own.find((g) =>
        kind === "other_source" ? g.name === want.name : g.name !== want.name && g.name.toLowerCase() === want.name.toLowerCase(),
      );
      if (match) return { kind, held: match, expected: want };
    }
  }
  return undefined;
}

/** Group `rows` of (owner, group) by owner, keeping their order. */
function groupsBy(rows: (NamedGroup & { owner: string })[]): Map<string, NamedGroup[]> {
  const byOwner = new Map<string, NamedGroup[]>();
  for (const { owner, ...named } of rows) byOwner.set(owner, [...(byOwner.get(owner) ?? []), named]);
  return byOwner;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byNameThenSource = (a: NamedGroup, b: NamedGroup) => compare(a.name, b.name) || compare(a.source, b.source);

/**
 * Return, for every link of the catalog (inactive included) or only `linkId`, whether the viewer sees it and
 * why not, in catalog order.
 *
 * `visible` is {@link linkVisibleWhere} itself, read in the same query as the parts of the rule, so it is true
 * exactly when the link is in {@link visibleCatalog}. Reasons are all listed: an inactive link still lists its
 * group reasons, and a link or category without any group says so instead of a missing group.
 */
export async function explainAccess(db: DB, viewer: UserViewer, linkId?: string): Promise<LinkExplanation[]> {
  const parts = accessParts(db, viewerGroupIds(db, viewer));
  const one = sql`1`;
  const flag = (condition: SQL) => sql<boolean>`${condition}`.mapWith(Boolean);
  const rows = await db
    .select({
      id: link.id,
      title: link.title,
      categoryId: category.id,
      categoryTitle: category.title,
      visible: flag(linkVisibleWhere(db, viewer)),
      active: flag(parts.active),
      holdsCategoryGroup: flag(parts.category),
      holdsLinkGroup: flag(parts.link),
      categoryHasGroup: flag(exists(db.select({ one }).from(categoryGroup).where(eq(categoryGroup.categoryId, category.id)))),
      linkHasGroup: flag(exists(db.select({ one }).from(linkGroup).where(eq(linkGroup.linkId, link.id)))),
      pinned: flag(exists(db.select({ one }).from(userLinkPin).where(and(eq(userLinkPin.userId, viewer.userId), eq(userLinkPin.linkId, link.id))))),
    })
    .from(link)
    .innerJoin(category, eq(category.id, link.categoryId))
    .where(linkId === undefined ? undefined : eq(link.id, linkId))
    .orderBy(asc(category.position), asc(category.id), asc(link.position), asc(link.id));
  if (rows.length === 0) return [];

  // Groups are read only for the hints: the reasons come from the query above.
  const named = { id: group.id, name: group.name, source: group.source };
  const [held, linkGroups, categoryGroups] = await Promise.all([
    db.select(named).from(group).where(inArray(group.id, viewerGroupIds(db, viewer))),
    db
      .select({ owner: linkGroup.linkId, ...named })
      .from(linkGroup)
      .innerJoin(group, eq(group.id, linkGroup.groupId))
      .where(linkId === undefined ? undefined : eq(linkGroup.linkId, linkId)),
    db
      .select({ owner: categoryGroup.categoryId, ...named })
      .from(categoryGroup)
      .innerJoin(group, eq(group.id, categoryGroup.groupId))
      .where(linkId === undefined ? undefined : eq(categoryGroup.categoryId, rows[0]!.categoryId)),
  ]);
  held.sort(byNameThenSource);
  const groupsOfLink = groupsBy(linkGroups.sort(byNameThenSource));
  const groupsOfCategory = groupsBy(categoryGroups.sort(byNameThenSource));

  return rows.map((row) => {
    const reasons: AccessReason[] = [];
    const missing = (code: AccessReasonCode, expected: NamedGroup[]) => {
      const hint = hintFor(held, expected);
      reasons.push(hint ? { code, hint } : { code });
    };
    if (!row.active) reasons.push({ code: "link_inactive" });
    if (!row.linkHasGroup) reasons.push({ code: "link_no_group" });
    if (!row.categoryHasGroup) reasons.push({ code: "category_no_group" });
    if (row.linkHasGroup && !row.holdsLinkGroup) missing("missing_link_group", groupsOfLink.get(row.id) ?? []);
    if (row.categoryHasGroup && !row.holdsCategoryGroup) missing("missing_category_group", groupsOfCategory.get(row.categoryId) ?? []);
    return {
      id: row.id,
      title: row.title,
      categoryId: row.categoryId,
      categoryTitle: row.categoryTitle,
      visible: row.visible,
      reasons,
      ...(row.pinned ? { pinned: true as const } : {}),
    };
  });
}

/** How many active accounts see a link or a category, and whether a visitor who is not signed in sees it. */
export type Audience = { people: number; public: boolean };

/**
 * Return who sees the link `linkId`, or at least one link of the category `categoryId`.
 *
 * `people` counts the accounts that are not disabled (a temporary password included) for whom the access rule
 * holds, administrators by the same rule, each once. The rule runs per account as a correlated subquery on
 * `user.id`, so no group list is bound as parameters (D1 refuses more than 100).
 */
export async function audienceOf(db: DB, target: { linkId: string } | { categoryId: string }): Promise<Audience> {
  const one = sql`1`;
  const where = "linkId" in target ? eq(link.id, target.linkId) : eq(category.id, target.categoryId);
  const seen = (ids: SQLWrapper) =>
    db
      .select({ one })
      .from(link)
      .innerJoin(category, eq(category.id, link.categoryId))
      .where(and(where, allOf(accessParts(db, ids))));
  const [people, visitor] = await Promise.all([
    db
      .select({ count: count() })
      .from(user)
      .where(and(eq(user.disabled, false), exists(seen(signedInGroupIds(db, user.id)))))
      .get(),
    seen(viewerGroupIds(db, { kind: "anonymous" })).limit(1).get(),
  ]);
  return { people: people?.count ?? 0, public: visitor !== undefined };
}
