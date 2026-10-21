import { and, asc, count, eq, inArray, notExists, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { type AuditAction, type AuditEntry, type Auditor, auditStatements, readSnapshot, snapshot, unchangedSince } from "../audit";
import type { DB } from "../db";
import { resolveIcon } from "../icons/resolve";
import { category, categoryGroup, group, link, linkGroup } from "../schema";
import { categoryFields, errorOf, ICON, ID, linkSchema, MAX_CATEGORIES, MAX_LINKS_PER_CATEGORY, parseKeywords } from "./format";
import { caseVariants, groupRef, insertGroupIfMissing, parseGroupRef } from "./groups";
import { bumpRevision, categoryGroupRows, guard, linkGroupRows } from "./sync";

/** A link as the admin screen shows it: everything stored, inactive links and links without a group included. */
export type AdminLink = {
  id: string;
  categoryId: string;
  title: string;
  description: string;
  url: string;
  icon: string | null;
  /** Whether `icon` names an icon YASAD serves; an unknown one is kept, as at import. */
  iconKnown: boolean;
  keywords: string[];
  active: boolean;
  /** Whether the server checks the link's address. */
  check: boolean;
  groups: string[];
  revision: number;
};
export type AdminCategory = { id: string; title: string; groups: string[]; revision: number; links: AdminLink[] };

/** A point the admin should know after a write that went through, as a code the interface translates. */
export type EditWarning = "no_group" | "unknown_icon" | "groups_differ_by_case" | "new_oidc_group";

/** A refused edit, answered as `{ error: { code, ...details } }` with `status`. */
export type EditFailure = { status: 404 | 409 | 422; code: string; details?: Record<string, unknown> };

/**
 * The audit entry of an edit. `snapshot` is the expression `entry.before` was read with: the batch fails
 * when it no longer gives that text, so the entry never shows a state the object was not in.
 */
export type EditAudit = { snapshot?: SQL; entry: AuditEntry };

/**
 * One admin gesture on the catalog, prepared but not run.
 *
 * {@link applyEdit} runs `statements` in one db.batch with the audit entry, so the entry exists exactly
 * when the write does, then reads the result with `afterOf`. The batch starts by checking what `before`
 * was read from, so `before` is exact when the batch succeeds. When it fails, `failureOf` reads the
 * database again and says why, or returns null for an error this gesture did not foresee.
 */
export type Edit<T> = {
  statements: [unknown, ...unknown[]];
  before: T | null;
  afterOf: () => Promise<T | null>;
  failureOf: () => Promise<EditFailure | "retry" | null>;
  warnings: EditWarning[];
  audit: EditAudit;
};

/** Who makes the change, for the audit log. */
export type Author = Auditor;

/** Return the audit of a change to an existing item, its snapshot read now. */
async function auditChange(db: DB, action: AuditAction, type: "category" | "link", id: string, expression: SQL, deletes = false): Promise<EditAudit> {
  const before = await readSnapshot(db, expression);
  return { snapshot: expression, entry: { action, type, id, before, after: deletes ? null : expression } };
}

const auditCreate = (type: "category" | "link", id: string, expression: SQL): EditAudit => ({
  entry: { action: "create", type, id, before: null, after: expression },
});

const REVISION = z.number().int();
const DIRECTION = z.strictObject({ direction: z.enum(["up", "down"]) });

const linkCreateSchema = linkSchema.extend({ id: ID.optional(), categoryId: z.string() });
const linkPatchSchema = linkSchema
  .omit({ id: true })
  .partial()
  .extend({ revision: REVISION, categoryId: z.string().optional(), icon: ICON.nullable().optional() });
const categoryCreateSchema = z.strictObject({ ...categoryFields, id: ID.optional() });
const categoryPatchSchema = z.strictObject({ revision: REVISION, title: categoryFields.title.optional(), groups: categoryFields.groups.optional() });
const categoryDeleteSchema = z.strictObject({ revision: REVISION, linkCount: z.number().int() });
const linkDeleteSchema = z.strictObject({ revision: REVISION });

const invalid = (fields: Record<string, string>): EditFailure => ({ status: 422, code: "invalid_input", details: { fields } });
const NOT_FOUND: EditFailure = { status: 404, code: "not_found" };
const CATALOG_FULL: EditFailure = { status: 409, code: "catalog_full" };

/** Return the parsed body, or the 422 naming each invalid field by its top-level name (`keywords[3]` is `keywords`). */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): { data: z.output<S> } | { failure: EditFailure } {
  const result = schema.safeParse(body, { reportInput: true });
  if (result.success) return { data: result.data };
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const { code } = errorOf(issue);
    for (const name of issue.code === "unrecognized_keys" ? issue.keys : [String(issue.path[0] ?? "body")]) fields[name] ??= code;
  }
  return { failure: invalid(fields) };
}

/** Return the id a title suggests: accents dropped, lower case, every other run of characters a hyphen, 64 at most. */
export function idFromTitle(title: string, fallback: string): string {
  const id = title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 64)
    .replace(/^-+|-+$/g, "");
  return id || fallback;
}

/** Return `base`, or the first of `base-2`, `base-3`... that no row of the table uses, within 64 characters. */
async function freeId(db: DB, table: typeof category | typeof link, base: string): Promise<string> {
  for (let from = 1; ; from += 20) {
    const candidates = Array.from({ length: 20 }, (_, i) => {
      if (from + i === 1) return base;
      const suffix = `-${from + i}`;
      return base.slice(0, 64 - suffix.length).replace(/-+$/, "") + suffix;
    });
    const taken = new Set((await db.select({ id: table.id }).from(table).where(inArray(table.id, candidates))).map((row) => row.id));
    const free = candidates.find((id) => !taken.has(id));
    if (free) return free;
  }
}

type GroupRow = { id: string; source: "oidc" | "local" | "system"; name: string };

/** Return the group references of each item, sorted, from rows of (item id, group). */
function refsBy(rows: GroupRow[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) map.set(row.id, [...(map.get(row.id) ?? []), groupRef(row)]);
  for (const refs of map.values()) refs.sort();
  return map;
}

function toAdminLink(row: typeof link.$inferSelect, groups: string[]): AdminLink {
  return {
    id: row.id,
    categoryId: row.categoryId,
    title: row.title,
    description: row.description,
    url: row.url,
    icon: row.icon,
    iconKnown: resolveIcon(row.icon) !== null,
    keywords: parseKeywords(row.keywords),
    active: row.active,
    check: row.check,
    groups,
    revision: row.revision,
  };
}

/** Return the categories with their links in display order (position, then id), or only the category `id`. */
export async function readCategories(db: DB, id?: string): Promise<AdminCategory[]> {
  const [categories, links, categoryGroups, linkGroups] = await Promise.all([
    db.select().from(category).where(id === undefined ? undefined : eq(category.id, id)).orderBy(asc(category.position), asc(category.id)),
    db.select().from(link).where(id === undefined ? undefined : eq(link.categoryId, id)).orderBy(asc(link.position), asc(link.id)),
    db
      .select({ id: categoryGroup.categoryId, source: group.source, name: group.name })
      .from(categoryGroup)
      .innerJoin(group, eq(group.id, categoryGroup.groupId))
      .where(id === undefined ? undefined : eq(categoryGroup.categoryId, id)),
    db
      .select({ id: linkGroup.linkId, source: group.source, name: group.name })
      .from(linkGroup)
      .innerJoin(group, eq(group.id, linkGroup.groupId))
      .innerJoin(link, eq(link.id, linkGroup.linkId))
      .where(id === undefined ? undefined : eq(link.categoryId, id)),
  ]);
  const catGroups = refsBy(categoryGroups);
  const lnkGroups = refsBy(linkGroups);
  return categories.map((cat) => ({
    id: cat.id,
    title: cat.title,
    groups: catGroups.get(cat.id) ?? [],
    revision: cat.revision,
    links: links.filter((lnk) => lnk.categoryId === cat.id).map((lnk) => toAdminLink(lnk, lnkGroups.get(lnk.id) ?? [])),
  }));
}

export async function readCategory(db: DB, id: string): Promise<AdminCategory | null> {
  return (await readCategories(db, id))[0] ?? null;
}

export async function readLink(db: DB, id: string): Promise<AdminLink | null> {
  const [row, groups] = await Promise.all([
    db.select().from(link).where(eq(link.id, id)).get(),
    db.select({ id: linkGroup.linkId, source: group.source, name: group.name }).from(linkGroup).innerJoin(group, eq(group.id, linkGroup.groupId)).where(eq(linkGroup.linkId, id)),
  ]);
  return row ? toAdminLink(row, refsBy(groups).get(id) ?? []) : null;
}

/**
 * Return the warnings and the refusal the referenced groups call for.
 *
 * A local or system group must exist: a local group is created on the groups screen. An OIDC group that
 * does not exist yet is created with the item, as an import does, and reported with `new_oidc_group`:
 * it gets members at the first sign-in of one of them.
 */
async function checkGroups(db: DB, refs: string[]): Promise<{ unknown: boolean; warnings: EditWarning[] }> {
  const existing = new Set((await db.select({ source: group.source, name: group.name }).from(group)).map(groupRef));
  const keys = refs.map((ref) => groupRef(parseGroupRef(ref)));
  const warnings: EditWarning[] = [];
  const missing = keys.filter((ref) => !existing.has(ref));
  if (missing.some((ref) => !ref.startsWith("oidc:"))) return { unknown: true, warnings };
  if (missing.length > 0) warnings.push("new_oidc_group");
  if (caseVariants(new Set([...existing, ...keys])).some((variants) => keys.some((ref) => variants.includes(ref)))) warnings.push("groups_differ_by_case");
  return { unknown: false, warnings };
}

/** Return whether a local or system group among `refs` no longer exists. */
async function lacksGroup(db: DB, refs: string[]): Promise<boolean> {
  return (await checkGroups(db, refs)).unknown;
}

/**
 * Return the statements making the referenced groups hold inside the batch: an OIDC group is created when
 * missing, a missing local or system group fails the batch. Without the guard, a group deleted between the
 * check and the write would leave the item without it, silently.
 */
function groupStatements(db: DB, refs: string[]): unknown[] {
  return [...new Set(refs)].map((ref) => {
    const key = parseGroupRef(ref);
    if (key.source === "oidc") return insertGroupIfMissing(db, key);
    return guard(db, notExists(db.select({ one: sql`1` }).from(group).where(and(eq(group.source, key.source), eq(group.name, key.name)))));
  });
}

/** Return the statement failing the batch unless the item still exists with this revision. */
function revisionGuard(db: DB, table: typeof category | typeof link, id: string, revision: number) {
  return guard(db, notExists(db.select({ one: sql`1` }).from(table).where(and(eq(table.id, id), eq(table.revision, revision)))));
}

function warningsOf(groups: string[], icon: string | null | undefined, groupWarnings: EditWarning[]): EditWarning[] {
  return [...(groups.length === 0 ? (["no_group"] as const) : []), ...(icon && !resolveIcon(icon) ? (["unknown_icon"] as const) : []), ...groupWarnings];
}

const linksIn = (db: DB, categoryId: string) => db.select({ n: count() }).from(link).where(eq(link.categoryId, categoryId));
const nextLinkPosition = (categoryId: string) =>
  sql<number>`(select coalesce(max(${link.position}) + 1, 0) from ${link} where ${link.categoryId} = ${categoryId})`;

type Move = { id: string; direction: "up" | "down" };

/**
 * Return the SQL source giving each row of a list its new position: its rank in (position, id) order,
 * from 0, with the moved row swapped with its neighbour. Computed when the statement runs, so a move
 * swaps with the neighbour in the stored order of that moment, and the list comes out dense whatever
 * it was.
 */
function placement(table: typeof category | typeof link, scope: SQL | undefined, move?: Move): SQL {
  const target = move?.id ?? null;
  const next =
    move?.direction === "up"
      ? sql`case when id = ${target} and r > 0 then r - 1 when r = t - 1 then r + 1 else r end`
      : move?.direction === "down"
        ? sql`case when id = ${target} and r < n - 1 then r + 1 when r = t + 1 then r - 1 else r end`
        : sql`r`;
  const ranked = sql`select ${table.id} as id, row_number() over (order by ${table.position}, ${table.id}) - 1 as r, count(*) over () as n from ${table}${scope ? sql` where ${scope}` : sql``}`;
  return sql`(select id, ${next} as next from (select id, r, n, max(case when id = ${target} then r end) over () as t from (${ranked}) as ranked) as placed) as m`;
}

/** Return the statement renumbering the categories from 0, with the moved one swapped with its neighbour. */
function placeCategories(db: DB, move?: Move) {
  return db.update(category).set({ position: sql`m.next` }).from(placement(category, undefined, move)).where(sql`${category.id} = m.id and ${category.position} <> m.next`);
}

/** Return the statement renumbering the links of a category from 0, with the moved one swapped with its neighbour. */
function placeLinks(db: DB, categoryId: string, move?: Move) {
  return db
    .update(link)
    .set({ position: sql`m.next` })
    .from(placement(link, eq(link.categoryId, categoryId), move))
    .where(sql`${link.id} = m.id and ${link.position} <> m.next`);
}

// ---------------------------------------------------------------- categories

export async function createCategory({ db }: Author, body: unknown): Promise<Edit<AdminCategory> | EditFailure> {
  const parsed = parseBody(categoryCreateSchema, body);
  if ("failure" in parsed) return parsed.failure;
  const input = parsed.data;
  const id = input.id ?? (await freeId(db, category, idFromTitle(input.title, "categorie")));
  const derived = input.id === undefined;
  if (!derived && (await readCategory(db, id))) return invalid({ id: "id_taken" });
  const groups = await checkGroups(db, input.groups);
  if (groups.unknown) return invalid({ groups: "unknown_group" });
  const full = sql`(select count(*) from ${category}) >= ${MAX_CATEGORIES}`;
  if ((await db.select({ n: count() }).from(category).get())!.n >= MAX_CATEGORIES) return CATALOG_FULL;

  return {
    statements: [
      bumpRevision(db),
      guard(db, full),
      ...groupStatements(db, input.groups),
      db.insert(category).values({ id, title: input.title, position: sql`(select coalesce(max(${category.position}) + 1, 0) from ${category})` }),
      ...categoryGroupRows(db, id, input.groups),
    ],
    before: null,
    afterOf: () => readCategory(db, id),
    audit: auditCreate("category", id, snapshot.category(id)),
    failureOf: async () => {
      if (await readCategory(db, id)) return derived ? "retry" : invalid({ id: "id_taken" });
      if (await lacksGroup(db, input.groups)) return invalid({ groups: "unknown_group" });
      if ((await db.select({ n: count() }).from(category).get())!.n >= MAX_CATEGORIES) return CATALOG_FULL;
      return null;
    },
    warnings: warningsOf(input.groups, null, groups.warnings),
  };
}

/** Return the 409 for an item changed or deleted since it was read, or null when it has not. */
function staleFailure<T extends { revision: number }>(current: T | null, revision: number, details: Record<string, unknown> = {}): EditFailure | null {
  if (!current) return NOT_FOUND;
  return current.revision === revision ? null : { status: 409, code: "item_changed", details: { current, ...details } };
}

export async function updateCategory({ db }: Author, id: string, body: unknown): Promise<Edit<AdminCategory> | EditFailure> {
  const before = await readCategory(db, id);
  if (!before) return NOT_FOUND;
  const parsed = parseBody(categoryPatchSchema, body);
  if ("failure" in parsed) return parsed.failure;
  const input = parsed.data;
  const stale = staleFailure(before, input.revision);
  if (stale) return stale;
  const groups = input.groups ? await checkGroups(db, input.groups) : { unknown: false, warnings: [] };
  if (groups.unknown) return invalid({ groups: "unknown_group" });

  return {
    statements: [
      bumpRevision(db),
      revisionGuard(db, category, id, input.revision),
      ...(input.groups ? groupStatements(db, input.groups) : []),
      db
        .update(category)
        .set({ ...(input.title !== undefined && { title: input.title }), revision: sql`${category.revision} + 1`, updatedAt: new Date() })
        .where(eq(category.id, id)),
      ...(input.groups ? [db.delete(categoryGroup).where(eq(categoryGroup.categoryId, id)), ...categoryGroupRows(db, id, input.groups)] : []),
    ],
    before,
    afterOf: () => readCategory(db, id),
    audit: await auditChange(db, "update", "category", id, snapshot.category(id)),
    failureOf: async () => {
      const stale = staleFailure(await readCategory(db, id), input.revision);
      if (stale) return stale;
      if (input.groups && (await lacksGroup(db, input.groups))) return invalid({ groups: "unknown_group" });
      return null;
    },
    warnings: warningsOf(input.groups ?? before.groups, null, groups.warnings),
  };
}

/**
 * Prepare moving a category one place up or down; at either end, the order stays as it is.
 *
 * The batch fails when the category was deleted meanwhile: the renumbering alone would succeed
 * without it and answer an order that no longer holds it.
 */
export async function moveCategory({ db }: Author, id: string, body: unknown): Promise<Edit<string[]> | EditFailure> {
  if (!(await readCategoryRow(db, id))) return NOT_FOUND;
  const parsed = parseBody(DIRECTION, body);
  if ("failure" in parsed) return parsed.failure;
  const order = async () => (await db.select({ id: category.id }).from(category).orderBy(asc(category.position), asc(category.id))).map((row) => row.id);
  return {
    statements: [
      bumpRevision(db),
      guard(db, notExists(db.select({ one: sql`1` }).from(category).where(eq(category.id, id)))),
      placeCategories(db, { id, direction: parsed.data.direction }),
    ],
    before: await order(),
    afterOf: order,
    audit: await auditChange(db, "move", "category", id, snapshot.category(id)),
    failureOf: async () => ((await readCategoryRow(db, id)) ? null : NOT_FOUND),
    warnings: [],
  };
}

/**
 * Prepare deleting a category with its links, which cascade with their groups.
 *
 * `linkCount` is the number of links the admin confirmed: the batch fails when the category holds
 * another number by then, so a link added meanwhile is never deleted unseen.
 */
export async function deleteCategory({ db }: Author, id: string, body: unknown): Promise<Edit<AdminCategory> | EditFailure> {
  const before = await readCategory(db, id);
  if (!before) return NOT_FOUND;
  const parsed = parseBody(categoryDeleteSchema, body);
  if ("failure" in parsed) return parsed.failure;
  const { revision, linkCount } = parsed.data;
  const staleOf = (current: AdminCategory | null) =>
    staleFailure(current, revision, { linkCount: current?.links.length }) ??
    (current!.links.length === linkCount ? null : ({ status: 409, code: "item_changed", details: { current, linkCount: current!.links.length } } as const));
  const stale = staleOf(before);
  if (stale) return stale;
  return {
    statements: [
      bumpRevision(db),
      revisionGuard(db, category, id, revision),
      guard(db, sql`(${linksIn(db, id)}) <> ${linkCount}`),
      db.delete(category).where(eq(category.id, id)),
      placeCategories(db),
    ],
    before,
    afterOf: () => readCategory(db, id),
    audit: await auditChange(db, "delete", "category", id, snapshot.deletedCategory(id), true),
    failureOf: async () => staleOf(await readCategory(db, id)),
    warnings: [],
  };
}

// ---------------------------------------------------------------------- links

export async function createLink({ db }: Author, body: unknown): Promise<Edit<AdminLink> | EditFailure> {
  const parsed = parseBody(linkCreateSchema, body);
  if ("failure" in parsed) return parsed.failure;
  const input = parsed.data;
  if (!(await readCategoryRow(db, input.categoryId))) return invalid({ categoryId: "unknown_category" });
  const id = input.id ?? (await freeId(db, link, idFromTitle(input.title, "lien")));
  const derived = input.id === undefined;
  if (!derived && (await readLink(db, id))) return invalid({ id: "id_taken" });
  const groups = await checkGroups(db, input.groups);
  if (groups.unknown) return invalid({ groups: "unknown_group" });
  if ((await linksIn(db, input.categoryId).get())!.n >= MAX_LINKS_PER_CATEGORY) return CATALOG_FULL;

  return {
    statements: [
      bumpRevision(db),
      guard(db, sql`(${linksIn(db, input.categoryId)}) >= ${MAX_LINKS_PER_CATEGORY}`),
      ...groupStatements(db, input.groups),
      db.insert(link).values({
        id,
        categoryId: input.categoryId,
        title: input.title,
        url: input.url,
        description: input.description ?? "",
        icon: input.icon ?? null,
        keywords: JSON.stringify(input.keywords ?? []),
        active: input.active ?? true,
        check: input.check ?? false,
        position: nextLinkPosition(input.categoryId),
      }),
      ...linkGroupRows(db, id, input.groups),
    ],
    before: null,
    afterOf: () => readLink(db, id),
    audit: auditCreate("link", id, snapshot.link(id)),
    failureOf: async () => {
      if (await readLink(db, id)) return derived ? "retry" : invalid({ id: "id_taken" });
      if (!(await readCategoryRow(db, input.categoryId))) return invalid({ categoryId: "unknown_category" });
      if (await lacksGroup(db, input.groups)) return invalid({ groups: "unknown_group" });
      if ((await linksIn(db, input.categoryId).get())!.n >= MAX_LINKS_PER_CATEGORY) return CATALOG_FULL;
      return null;
    },
    warnings: warningsOf(input.groups, input.icon, groups.warnings),
  };
}

const readCategoryRow = (db: DB, id: string) => db.select({ id: category.id }).from(category).where(eq(category.id, id)).get();

/**
 * Prepare changing a link; absent fields stay as they are, and `icon: null` removes the icon.
 *
 * A new `categoryId` places the link last in that category and renumbers the one it leaves.
 */
export async function updateLink({ db }: Author, id: string, body: unknown): Promise<Edit<AdminLink> | EditFailure> {
  const before = await readLink(db, id);
  if (!before) return NOT_FOUND;
  const parsed = parseBody(linkPatchSchema, body);
  if ("failure" in parsed) return parsed.failure;
  const { revision, categoryId, groups: refs, keywords, ...fields } = parsed.data;
  const stale = staleFailure(before, revision);
  if (stale) return stale;
  const moves = categoryId !== undefined && categoryId !== before.categoryId;
  if (moves && !(await readCategoryRow(db, categoryId))) return invalid({ categoryId: "unknown_category" });
  const groups = refs ? await checkGroups(db, refs) : { unknown: false, warnings: [] };
  if (groups.unknown) return invalid({ groups: "unknown_group" });
  if (moves && (await linksIn(db, categoryId).get())!.n >= MAX_LINKS_PER_CATEGORY) return CATALOG_FULL;

  return {
    statements: [
      bumpRevision(db),
      revisionGuard(db, link, id, revision),
      ...(refs ? groupStatements(db, refs) : []),
      ...(moves ? [guard(db, sql`(${linksIn(db, categoryId)}) >= ${MAX_LINKS_PER_CATEGORY}`)] : []),
      db
        .update(link)
        .set({
          ...fields,
          ...(keywords !== undefined && { keywords: JSON.stringify(keywords) }),
          ...(moves && { categoryId, position: nextLinkPosition(categoryId) }),
          revision: sql`${link.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(link.id, id)),
      ...(refs ? [db.delete(linkGroup).where(eq(linkGroup.linkId, id)), ...linkGroupRows(db, id, refs)] : []),
      ...(moves ? [placeLinks(db, before.categoryId)] : []),
    ],
    before,
    afterOf: () => readLink(db, id),
    audit: await auditChange(db, "update", "link", id, snapshot.link(id)),
    failureOf: async () => {
      const stale = staleFailure(await readLink(db, id), revision);
      if (stale) return stale;
      if (moves && !(await readCategoryRow(db, categoryId))) return invalid({ categoryId: "unknown_category" });
      if (refs && (await lacksGroup(db, refs))) return invalid({ groups: "unknown_group" });
      if (moves && (await linksIn(db, categoryId).get())!.n >= MAX_LINKS_PER_CATEGORY) return CATALOG_FULL;
      return null;
    },
    warnings: warningsOf(refs ?? before.groups, fields.icon === undefined ? before.icon : fields.icon, groups.warnings),
  };
}

/**
 * Prepare moving a link one place up or down within its category; at either end, the order stays as it is.
 *
 * The batch fails when the link was deleted or put in another category meanwhile: the renumbering
 * alone would succeed without it and answer an order that no longer holds it. A link in another
 * category is answered `item_changed` with the link as stored, so the row shows where it went.
 */
export async function moveLink({ db }: Author, id: string, body: unknown): Promise<Edit<string[]> | EditFailure> {
  const before = await readLink(db, id);
  if (!before) return NOT_FOUND;
  const parsed = parseBody(DIRECTION, body);
  if ("failure" in parsed) return parsed.failure;
  const { categoryId } = before;
  const order = async () =>
    (await db.select({ id: link.id }).from(link).where(eq(link.categoryId, categoryId)).orderBy(asc(link.position), asc(link.id))).map((row) => row.id);
  return {
    statements: [
      bumpRevision(db),
      guard(db, notExists(db.select({ one: sql`1` }).from(link).where(and(eq(link.id, id), eq(link.categoryId, categoryId))))),
      placeLinks(db, categoryId, { id, direction: parsed.data.direction }),
    ],
    before: await order(),
    afterOf: order,
    audit: await auditChange(db, "move", "link", id, snapshot.link(id)),
    failureOf: async () => {
      const current = await readLink(db, id);
      if (!current) return NOT_FOUND;
      return current.categoryId === categoryId ? null : { status: 409, code: "item_changed", details: { current } };
    },
    warnings: [],
  };
}

/** Prepare deleting a link; its category is renumbered in the same batch, so its positions stay dense. */
export async function deleteLink({ db }: Author, id: string, body: unknown): Promise<Edit<AdminLink> | EditFailure> {
  const before = await readLink(db, id);
  if (!before) return NOT_FOUND;
  const parsed = parseBody(linkDeleteSchema, body);
  if ("failure" in parsed) return parsed.failure;
  const { revision } = parsed.data;
  const stale = staleFailure(before, revision);
  if (stale) return stale;
  return {
    statements: [bumpRevision(db), revisionGuard(db, link, id, revision), db.delete(link).where(eq(link.id, id)), placeLinks(db, before.categoryId)],
    before,
    afterOf: () => readLink(db, id),
    audit: await auditChange(db, "delete", "link", id, snapshot.link(id), true),
    failureOf: async () => staleFailure(await readLink(db, id), revision),
    warnings: [],
  };
}

/**
 * Prepare and run an edit with its audit entry, and return it with the state after it, or why it was refused.
 *
 * An id derived from the title that another write took meanwhile is derived again, a few times; so is
 * an edit whose audit snapshot changed meanwhile without making the edit stale (a group renamed, a
 * neighbour moved), so that the entry's `before` is the state the edit really changed.
 */
export async function applyEdit<T>(author: Author, prepare: () => Promise<Edit<T> | EditFailure>): Promise<{ edit: Edit<T>; after: T | null } | EditFailure> {
  const { db } = author;
  for (let attempt = 1; ; attempt++) {
    const edit = await prepare();
    if ("status" in edit) return edit;
    const { snapshot: expression, entry } = edit.audit;
    const statements: unknown[] = [...(expression ? [unchangedSince(db, expression, entry.before)] : []), ...edit.statements, ...auditStatements(author, entry)];
    try {
      await db.batch(statements as [unknown, ...unknown[]]);
    } catch (err) {
      const failure = await edit.failureOf();
      const moved = failure === null && expression !== undefined && (await readSnapshot(db, expression)) !== entry.before;
      if ((failure === "retry" || moved) && attempt < 5) continue;
      if (failure === null || failure === "retry") throw err;
      return failure;
    }
    return { edit, after: await edit.afterOf() };
  }
}
