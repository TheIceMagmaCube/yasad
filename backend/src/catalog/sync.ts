import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { DB } from "../db";
import { category, categoryGroup, group, link, linkGroup } from "../schema";
import { type Catalog, type CatalogCategory, type CatalogError, type CatalogLink, parseCatalog } from "./format";
import { groupRef, insertGroupIfMissing, parseGroupRef } from "./groups";

export type CatalogDiff = {
  added: { categories: string[]; links: string[] };
  updated: { categories: string[]; links: string[] };
  removed: { categories: string[]; links: string[] };
  groupsCreated: string[];
  warnings: string[];
};

/** Return the catalog stored in the database, in display order. */
export async function readCatalog(db: DB): Promise<Catalog> {
  const [categories, links, categoryGroups, linkGroups] = await Promise.all([
    db.select().from(category).orderBy(asc(category.position)),
    db.select().from(link).orderBy(asc(link.position)),
    db.select({ id: categoryGroup.categoryId, source: group.source, name: group.name }).from(categoryGroup).innerJoin(group, eq(group.id, categoryGroup.groupId)),
    db.select({ id: linkGroup.linkId, source: group.source, name: group.name }).from(linkGroup).innerJoin(group, eq(group.id, linkGroup.groupId)),
  ]);
  const refsBy = (rows: { id: string; source: "oidc" | "local" | "system"; name: string }[]) => {
    const map = new Map<string, string[]>();
    for (const row of rows) map.set(row.id, [...(map.get(row.id) ?? []), groupRef(row)]);
    for (const refs of map.values()) refs.sort();
    return map;
  };
  const catGroups = refsBy(categoryGroups);
  const lnkGroups = refsBy(linkGroups);
  return {
    version: 1,
    categories: categories.map((cat) => ({
      id: cat.id,
      title: cat.title,
      groups: catGroups.get(cat.id) ?? [],
      links: links
        .filter((lnk) => lnk.categoryId === cat.id)
        .map((lnk) => ({
          id: lnk.id,
          title: lnk.title,
          url: lnk.url,
          description: lnk.description || undefined,
          icon: lnk.icon ?? undefined,
          keywords: (JSON.parse(lnk.keywords) as string[]).length ? (JSON.parse(lnk.keywords) as string[]) : undefined,
          groups: lnkGroups.get(lnk.id) ?? [],
          active: lnk.active ? undefined : false,
        })),
    })),
  };
}

/** Return the catalog with default values filled in and group lists sorted, so equal catalogs compare equal. */
function normalize(catalog: Catalog): Catalog {
  return {
    version: 1,
    categories: catalog.categories.map((cat) => ({
      ...cat,
      groups: [...new Set(cat.groups)].sort(),
      links: cat.links.map((lnk) => ({
        id: lnk.id,
        title: lnk.title,
        url: lnk.url,
        description: lnk.description ?? "",
        icon: lnk.icon ?? "",
        keywords: lnk.keywords ?? [],
        groups: [...new Set(lnk.groups)].sort(),
        active: lnk.active ?? true,
      })) as CatalogLink[],
    })),
  };
}

/** Return a fingerprint of the catalog, sent with the preview and checked on confirmation. */
export async function catalogVersion(catalog: Catalog): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(normalize(catalog)));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Placed<T> = T & { position: number; categoryId?: string };

function categoriesOf(catalog: Catalog): Map<string, Placed<Omit<CatalogCategory, "links">>> {
  return new Map(catalog.categories.map((cat, i) => [cat.id, { id: cat.id, title: cat.title, groups: cat.groups, position: i }]));
}

function linksOf(catalog: Catalog): Map<string, Placed<CatalogLink>> {
  return new Map(catalog.categories.flatMap((cat) => cat.links.map((lnk, j) => [lnk.id, { ...lnk, position: j, categoryId: cat.id }] as const)));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Return what applying `next` over `current` adds, changes and removes, with warnings for the admin. */
export async function diffCatalog(db: DB, current: Catalog, next: Catalog): Promise<CatalogDiff> {
  const [cur, nxt] = [normalize(current), normalize(next)];
  const diff: CatalogDiff = {
    added: { categories: [], links: [] },
    updated: { categories: [], links: [] },
    removed: { categories: [], links: [] },
    groupsCreated: [],
    warnings: [],
  };
  for (const [kind, before, after] of [
    ["categories", categoriesOf(cur), categoriesOf(nxt)],
    ["links", linksOf(cur), linksOf(nxt)],
  ] as const) {
    for (const [id, item] of after) {
      const old = (before as Map<string, unknown>).get(id);
      if (!old) diff.added[kind].push(id);
      else if (!same(old, item)) diff.updated[kind].push(id);
    }
    for (const id of before.keys()) if (!after.has(id)) diff.removed[kind].push(id);
  }

  const refs = new Set(nxt.categories.flatMap((cat) => [...cat.groups, ...cat.links.flatMap((lnk) => lnk.groups)]));
  const existing = new Set((await db.select({ source: group.source, name: group.name }).from(group)).map(groupRef));
  diff.groupsCreated = [...refs].filter((ref) => !existing.has(groupRef(parseGroupRef(ref)))).sort();

  for (const cat of nxt.categories) {
    if (cat.groups.length === 0) diff.warnings.push(`Category "${cat.id}" has no group: nobody can see it.`);
    for (const lnk of cat.links) if (lnk.groups.length === 0) diff.warnings.push(`Link "${lnk.id}" has no group: nobody can see it.`);
  }
  const byLowerCase = new Map<string, Set<string>>();
  for (const ref of new Set([...refs, ...existing])) {
    const key = ref.toLowerCase();
    byLowerCase.set(key, (byLowerCase.get(key) ?? new Set()).add(ref));
  }
  for (const variants of byLowerCase.values()) {
    if (variants.size > 1) diff.warnings.push(`Groups differ only by case: ${[...variants].sort().join(", ")}.`);
  }
  return diff;
}

/** Return whether the diff changes nothing. */
export function isEmpty(diff: CatalogDiff): boolean {
  return [diff.added, diff.updated, diff.removed].every((part) => part.categories.length === 0 && part.links.length === 0);
}

/** Return the statements linking one category to its groups, matched by (source, name). */
function categoryGroupRows(db: DB, categoryId: string, refs: string[]) {
  return refs.map((ref) => {
    const { source, name } = parseGroupRef(ref);
    return db
      .insert(categoryGroup)
      .select(db.select({ categoryId: sql<string>`${categoryId}`.as("category_id"), groupId: group.id }).from(group).where(and(eq(group.source, source), eq(group.name, name))));
  });
}

/** Return the statements linking one link to its groups, matched by (source, name). */
function linkGroupRows(db: DB, linkId: string, refs: string[]) {
  return refs.map((ref) => {
    const { source, name } = parseGroupRef(ref);
    return db
      .insert(linkGroup)
      .select(db.select({ linkId: sql<string>`${linkId}`.as("link_id"), groupId: group.id }).from(group).where(and(eq(group.source, source), eq(group.name, name))));
  });
}

/**
 * Write `next` over the stored catalog in one batch, touching only what the diff lists.
 *
 * Missing groups are created first; group links are matched by (source, name), so a group created
 * concurrently is still the one used.
 */
export async function applyCatalog(db: DB, next: Catalog, diff: CatalogDiff): Promise<void> {
  if (isEmpty(diff)) return;
  const now = new Date();
  const cats = categoriesOf(next);
  const lnks = linksOf(next);
  const statements = [];

  for (const ref of diff.groupsCreated) statements.push(insertGroupIfMissing(db, parseGroupRef(ref)));

  for (const id of [...diff.added.categories, ...diff.updated.categories]) {
    const cat = cats.get(id)!;
    statements.push(
      db
        .insert(category)
        .values({ id, title: cat.title, position: cat.position, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: category.id, set: { title: cat.title, position: cat.position, updatedAt: now } }),
      db.delete(categoryGroup).where(eq(categoryGroup.categoryId, id)),
      ...categoryGroupRows(db, id, cat.groups),
    );
  }
  for (const id of [...diff.added.links, ...diff.updated.links]) {
    const lnk = lnks.get(id)!;
    const values = {
      categoryId: lnk.categoryId!,
      title: lnk.title,
      url: lnk.url,
      description: lnk.description ?? "",
      icon: lnk.icon || null,
      keywords: JSON.stringify(lnk.keywords ?? []),
      position: lnk.position,
      active: lnk.active ?? true,
      updatedAt: now,
    };
    statements.push(
      db.insert(link).values({ id, ...values, createdAt: now }).onConflictDoUpdate({ target: link.id, set: values }),
      db.delete(linkGroup).where(eq(linkGroup.linkId, id)),
      ...linkGroupRows(db, id, lnk.groups),
    );
  }
  if (diff.removed.links.length > 0) {
    statements.push(
      db.delete(linkGroup).where(inArray(linkGroup.linkId, diff.removed.links)),
      db.delete(link).where(inArray(link.id, diff.removed.links)),
    );
  }
  if (diff.removed.categories.length > 0) {
    statements.push(
      db.delete(categoryGroup).where(inArray(categoryGroup.categoryId, diff.removed.categories)),
      db.delete(link).where(inArray(link.categoryId, diff.removed.categories)),
      db.delete(category).where(inArray(category.id, diff.removed.categories)),
    );
  }
  await db.batch(statements as [unknown, ...unknown[]]);
}

export type ImportResult =
  | { status: "invalid"; errors: CatalogError[] }
  | { status: "changed" }
  | { status: "preview" | "applied"; diff: CatalogDiff; baseVersion: string };

/**
 * Validate the file, compare it with the stored catalog and, unless `dryRun`, apply it.
 *
 * Applying needs the `baseVersion` returned by the preview (when given), so a catalog changed in the
 * meantime is not overwritten unseen. An invalid file writes nothing.
 */
export async function importCatalog(db: DB, text: string, options: { dryRun: boolean; baseVersion?: string }): Promise<ImportResult> {
  const parsed = parseCatalog(text);
  if (!parsed.ok) return { status: "invalid", errors: parsed.errors };
  const current = await readCatalog(db);
  const baseVersion = await catalogVersion(current);
  if (options.baseVersion !== undefined && options.baseVersion !== baseVersion) return { status: "changed" };
  const diff = await diffCatalog(db, current, parsed.catalog);
  if (!options.dryRun) await applyCatalog(db, parsed.catalog, diff);
  return { status: options.dryRun ? "preview" : "applied", diff, baseVersion };
}
