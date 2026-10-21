import { and, asc, eq, exists, inArray, ne, or, type SQL, sql } from "drizzle-orm";

import { type AuditEntry, type Auditor, auditStatements } from "../audit";
import type { DB } from "../db";
import { resolveIcon } from "../icons/resolve";
import { category, categoryGroup, group, link, linkGroup, linkStatus, setting } from "../schema";
import { type CheckWarning, checkWarnings } from "./check-warnings";
import { type Catalog, type CatalogCategory, type CatalogError, type CatalogLink, parseCatalog, parseKeywords } from "./format";
import { caseVariants, groupRef, insertGroupIfMissing, parseGroupRef } from "./groups";

/** A point the admin should check before applying, as a code the interface translates. */
export type CatalogWarning =
  | { code: "no_group"; kind: "category" | "link"; id: string }
  | { code: "unknown_icon"; kind: "link"; id: string }
  | { code: CheckWarning; kind: "link"; id: string }
  | { code: "groups_differ_by_case"; groups: string[] };

export type CatalogDiff = {
  added: { categories: string[]; links: string[] };
  updated: { categories: string[]; links: string[] };
  removed: { categories: string[]; links: string[] };
  groupsCreated: string[];
  warnings: CatalogWarning[];
  /**
   * Title of every category and link listed above or named by a warning, with the link's category, and of the
   * category holding each such link even when that category is unchanged. Added, updated and warned items and
   * the categories holding them take the title from the file; removed items and the categories holding them,
   * from the stored catalog, except a category the file renames, which keeps its new title.
   */
  labels: { categories: Record<string, string>; links: Record<string, { title: string; categoryId: string }> };
};

const REVISION_KEY = "catalog.revision";

// Above this size, an import's entry keeps the summary only: a row must stay under D1's 2 MB.
const MAX_AUDIT_COLUMN = 512 * 1024;

// D1 refuses a statement with more than 100 bound parameters.
const MAX_IDS_PER_STATEMENT = 90;

/** Return the revision of the stored catalog, increased by every write; "0" before the first one. */
async function readRevision(db: DB): Promise<string> {
  const row = await db.select({ value: setting.value }).from(setting).where(eq(setting.key, REVISION_KEY)).get();
  return row?.value ?? "0";
}

/**
 * Return the statement increasing the catalog revision, for a write that changes the exported file
 * outside an import (a group renamed or deleted); usable in db.batch.
 */
export function bumpRevision(db: DB) {
  return db
    .insert(setting)
    .values({ key: REVISION_KEY, value: "1" })
    .onConflictDoUpdate({ target: setting.key, set: { value: sql`cast(${setting.value} as integer) + 1`, updatedAt: new Date() } });
}

/**
 * Return a statement that fails on a primary key conflict when `condition` holds, rolling its batch back.
 *
 * It copies the revision row onto itself, so it only fails once that row exists: put it after
 * {@link bumpRevision} unless the missing row is meant to pass.
 */
export function guard(db: DB, condition: SQL) {
  return db.insert(setting).select(db.select().from(setting).where(and(eq(setting.key, REVISION_KEY), condition)));
}

/** Return the list cut into slices short enough to bind in one statement. */
function chunks<T>(items: T[]): T[][] {
  return Array.from({ length: Math.ceil(items.length / MAX_IDS_PER_STATEMENT) }, (_, i) => items.slice(i * MAX_IDS_PER_STATEMENT, (i + 1) * MAX_IDS_PER_STATEMENT));
}

/** Return the catalog stored in the database, in display order. */
export async function readCatalog(db: DB): Promise<Catalog> {
  const [categories, links, categoryGroups, linkGroups] = await Promise.all([
    db.select().from(category).orderBy(asc(category.position), asc(category.id)),
    db.select().from(link).orderBy(asc(link.position), asc(link.id)),
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
          keywords: parseKeywords(lnk.keywords).length ? parseKeywords(lnk.keywords) : undefined,
          groups: lnkGroups.get(lnk.id) ?? [],
          active: lnk.active ? undefined : false,
          check: lnk.check ? true : undefined,
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
        check: lnk.check ?? false,
      })) as CatalogLink[],
    })),
  };
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
  const categories = { before: categoriesOf(cur), after: categoriesOf(nxt) };
  const links = { before: linksOf(cur), after: linksOf(nxt) };
  const diff: CatalogDiff = {
    added: { categories: [], links: [] },
    updated: { categories: [], links: [] },
    removed: { categories: [], links: [] },
    groupsCreated: [],
    warnings: [],
    labels: { categories: {}, links: {} },
  };
  for (const [kind, { before, after }] of [
    ["categories", categories],
    ["links", links],
  ] as const) {
    for (const [id, item] of after) {
      const old = (before as Map<string, unknown>).get(id);
      if (!old) diff.added[kind].push(id);
      else if (!same(old, item)) diff.updated[kind].push(id);
    }
    for (const id of before.keys()) if (!after.has(id)) diff.removed[kind].push(id);
  }
  const labelled = <T>(kind: "categories" | "links", items: { before: Map<string, T>; after: Map<string, T> }) => [
    ...[...diff.added[kind], ...diff.updated[kind]].map((id) => ({ id, item: items.after.get(id)!, side: "after" as const })),
    ...diff.removed[kind].map((id) => ({ id, item: items.before.get(id)!, side: "before" as const })),
  ];
  const changedLinks = labelled("links", links);
  // Holding categories come first, so a category listed in the diff keeps its own title.
  const holders = changedLinks.map(({ item, side }) => categories[side].get(item.categoryId!)!);
  diff.labels = {
    categories: Object.fromEntries([...holders, ...labelled("categories", categories).map(({ item }) => item)].map((cat) => [cat.id, cat.title])),
    links: Object.fromEntries(changedLinks.map(({ id, item }) => [id, { title: item.title, categoryId: item.categoryId! }])),
  };

  const refs = new Set(nxt.categories.flatMap((cat) => [...cat.groups, ...cat.links.flatMap((lnk) => lnk.groups)]));
  const existing = new Set((await db.select({ source: group.source, name: group.name }).from(group)).map(groupRef));
  diff.groupsCreated = [...refs].filter((ref) => !existing.has(groupRef(parseGroupRef(ref)))).sort();

  for (const cat of nxt.categories) {
    if (cat.groups.length === 0) diff.warnings.push({ code: "no_group", kind: "category", id: cat.id });
    for (const lnk of cat.links) {
      if (lnk.groups.length === 0) diff.warnings.push({ code: "no_group", kind: "link", id: lnk.id });
      // Kept as written: the file may target another icon version.
      if (lnk.icon && !resolveIcon(lnk.icon)) diff.warnings.push({ code: "unknown_icon", kind: "link", id: lnk.id });
      // Static, as on an edit: the import is never refused for them.
      for (const code of checkWarnings(lnk.url, lnk.check ?? false)) diff.warnings.push({ code, kind: "link", id: lnk.id });
    }
  }
  for (const groups of caseVariants(new Set([...refs, ...existing]))) diff.warnings.push({ code: "groups_differ_by_case", groups });
  // Own keys only: an id such as "constructor" must not find the one Object.prototype holds.
  const { categories: catLabels, links: linkLabels } = diff.labels;
  for (const warning of diff.warnings) {
    if (warning.code === "groups_differ_by_case") continue;
    const categoryId = warning.kind === "category" ? warning.id : links.after.get(warning.id)!.categoryId!;
    if (warning.kind === "link" && !Object.hasOwn(linkLabels, warning.id)) {
      linkLabels[warning.id] = { title: links.after.get(warning.id)!.title, categoryId };
    }
    if (!Object.hasOwn(catLabels, categoryId)) catLabels[categoryId] = categories.after.get(categoryId)!.title;
  }
  return diff;
}

/** Return whether the diff changes nothing. */
export function isEmpty(diff: CatalogDiff): boolean {
  return [diff.added, diff.updated, diff.removed].every((part) => part.categories.length === 0 && part.links.length === 0);
}

/** Return the statements linking one category to its groups, matched by (source, name). */
export function categoryGroupRows(db: DB, categoryId: string, refs: string[]) {
  return [...new Set(refs)].map((ref) => {
    const { source, name } = parseGroupRef(ref);
    return db
      .insert(categoryGroup)
      .select(db.select({ categoryId: sql<string>`${categoryId}`.as("category_id"), groupId: group.id }).from(group).where(and(eq(group.source, source), eq(group.name, name))));
  });
}

/** Return the statements linking one link to its groups, matched by (source, name). */
export function linkGroupRows(db: DB, linkId: string, refs: string[]) {
  return [...new Set(refs)].map((ref) => {
    const { source, name } = parseGroupRef(ref);
    return db
      .insert(linkGroup)
      .select(db.select({ linkId: sql<string>`${linkId}`.as("link_id"), groupId: group.id }).from(group).where(and(eq(group.source, source), eq(group.name, name))));
  });
}

/**
 * Write `next` over the stored catalog in one batch, touching only what the diff lists.
 *
 * The batch starts with a guard that fails on a primary key conflict when the revision is no longer
 * `revision`, so it rolls back whole if another write came first, and ends by increasing the revision.
 * Missing groups are created first; group links are matched by (source, name), so a group created
 * concurrently is still the one used. Each updated item gets a new revision, so an edit started in
 * the app before the import is refused.
 */
export async function applyCatalog(db: DB, next: Catalog, diff: CatalogDiff, revision: string, audit: unknown[] = []): Promise<void> {
  if (isEmpty(diff)) return;
  const now = new Date();
  const cats = categoriesOf(next);
  const lnks = linksOf(next);
  // A missing revision row is revision "0": it cannot appear without a write, which stores "1" or more.
  const statements: unknown[] = [guard(db, ne(setting.value, revision))];

  for (const ref of diff.groupsCreated) statements.push(insertGroupIfMissing(db, parseGroupRef(ref)));

  for (const id of [...diff.added.categories, ...diff.updated.categories]) {
    const cat = cats.get(id)!;
    statements.push(
      db
        .insert(category)
        .values({ id, title: cat.title, position: cat.position, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: category.id,
          set: { title: cat.title, position: cat.position, revision: sql`${category.revision} + 1`, updatedAt: now },
        }),
      db.delete(categoryGroup).where(eq(categoryGroup.categoryId, id)),
      ...categoryGroupRows(db, id, cat.groups),
    );
  }
  const updated = new Set(diff.updated.links);
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
      check: lnk.check ?? false,
      updatedAt: now,
    };
    statements.push(
      // Before the upsert: it compares the stored link with the file. An old result says nothing about a new address.
      ...(updated.has(id)
        ? [
            db
              .delete(linkStatus)
              .where(
                and(
                  eq(linkStatus.linkId, id),
                  eq(linkStatus.source, "yasad"),
                  exists(
                    db
                      .select({ one: sql`1` })
                      .from(link)
                      .where(and(eq(link.id, id), or(ne(link.url, lnk.url), ne(link.check, lnk.check ?? false)))),
                  ),
                ),
              ),
          ]
        : []),
      db
        .insert(link)
        .values({ id, ...values, createdAt: now })
        .onConflictDoUpdate({ target: link.id, set: { ...values, revision: sql`${link.revision} + 1` } }),
      db.delete(linkGroup).where(eq(linkGroup.linkId, id)),
      ...linkGroupRows(db, id, lnk.groups),
    );
  }
  for (const ids of chunks(diff.removed.links)) {
    statements.push(db.delete(linkGroup).where(inArray(linkGroup.linkId, ids)), db.delete(link).where(inArray(link.id, ids)));
  }
  for (const ids of chunks(diff.removed.categories)) {
    statements.push(
      db.delete(categoryGroup).where(inArray(categoryGroup.categoryId, ids)),
      db.delete(link).where(inArray(link.categoryId, ids)),
      db.delete(category).where(inArray(category.id, ids)),
    );
  }
  const nextRevision = String(Number(revision) + 1);
  statements.push(
    ...audit,
    db
      .insert(setting)
      .values({ key: REVISION_KEY, value: nextRevision, updatedAt: now })
      .onConflictDoUpdate({ target: setting.key, set: { value: nextRevision, updatedAt: now } }),
  );
  await db.batch(statements as [unknown, ...unknown[]]);
}

const bytes = (text: string) => new TextEncoder().encode(text).length;

/**
 * Return the audit entry of an import: the diff as summary, and the items it changes or removes as they
 * were (`before`) and the items it adds or changes as they become (`after`), keyed by id.
 */
function importEntry(current: Catalog, next: Catalog, diff: CatalogDiff, source?: "catalog_file"): AuditEntry {
  const [cur, nxt] = [normalize(current), normalize(next)];
  const pick = <T>(items: Map<string, T>, ids: string[]) => Object.fromEntries(ids.map((id) => [id, items.get(id)!]));
  let before: string | null = JSON.stringify({
    categories: pick(categoriesOf(cur), [...diff.updated.categories, ...diff.removed.categories]),
    links: pick(linksOf(cur), [...diff.updated.links, ...diff.removed.links]),
  });
  let after: string | null = JSON.stringify({
    categories: pick(categoriesOf(nxt), [...diff.added.categories, ...diff.updated.categories]),
    links: pick(linksOf(nxt), [...diff.added.links, ...diff.updated.links]),
  });
  const { added, updated, removed, groupsCreated, labels } = diff;
  const details: Record<string, unknown> = { added, updated, removed, groupsCreated, labels, ...(source && { source }) };
  if (bytes(before) > MAX_AUDIT_COLUMN || bytes(after) > MAX_AUDIT_COLUMN) {
    [before, after] = [null, null];
    details.truncated = true;
  }
  if (bytes(JSON.stringify(details)) > MAX_AUDIT_COLUMN) {
    delete details.labels;
    details.truncated = true;
  }
  return { action: "import", type: "catalog", id: null, label: null, before, after, details, when: sql`1` };
}

export type ImportResult =
  | { status: "invalid"; errors: CatalogError[] }
  | { status: "changed" }
  | { status: "preview" | "applied"; diff: CatalogDiff; baseVersion: string };

/**
 * Validate the file, compare it with the stored catalog and, unless `dryRun`, apply it.
 *
 * `baseVersion` is the catalog revision, read before the catalog so that it is never newer than what
 * the diff was computed from. Applying with the `baseVersion` of a preview refuses a catalog changed
 * since; without one, the revision just read is used. An invalid file writes nothing.
 */
export async function importCatalog(
  db: DB,
  text: string,
  options: { dryRun: boolean; baseVersion?: string; auditor: Auditor; source?: "catalog_file" },
): Promise<ImportResult> {
  const parsed = parseCatalog(text);
  if (!parsed.ok) return { status: "invalid", errors: parsed.errors };
  const baseVersion = await readRevision(db);
  if (options.baseVersion !== undefined && options.baseVersion !== baseVersion) return { status: "changed" };
  const current = await readCatalog(db);
  const diff = await diffCatalog(db, current, parsed.catalog);
  if (!options.dryRun) {
    try {
      const audit = auditStatements(options.auditor, importEntry(current, parsed.catalog, diff, options.source));
      await applyCatalog(db, parsed.catalog, diff, baseVersion, audit);
    } catch (err) {
      if ((await readRevision(db)) !== baseVersion) return { status: "changed" };
      throw err;
    }
  }
  return { status: options.dryRun ? "preview" : "applied", diff, baseVersion };
}
