import { type SQL, sql } from "drizzle-orm";

import type { DB } from "./db";
import { auditLog, setting } from "./schema";

export type AuditAction = "create" | "update" | "delete" | "move" | "password_reset" | "member_add" | "member_remove" | "import";
export type AuditObjectType = "user" | "group" | "category" | "link" | "catalog";
export const AUDIT_OBJECT_TYPES: readonly AuditObjectType[] = ["user", "group", "category", "link", "catalog"];

/** Who writes, and how long entries are kept; `actorId` is null for what YASAD does by itself. */
export type Auditor = { db: DB; actorId: string | null; retentionDays: number };

const DAY_MS = 86_400_000;

/**
 * Return the earliest `at` still kept, in SQL.
 *
 * Computed with the same clock as the delete trigger, so a purge never reaches an entry the trigger protects.
 */
export const retentionStart = (days: number) => sql`(unixepoch() * 1000 - ${days} * ${DAY_MS})`;

// Snapshots name the columns they keep, never the others: a column added later stays out of the log
// until it is written here. Passwords, tokens and sessions never appear.

const bool = (column: string) => sql.raw(`json(case when ${column} then 'true' else 'false' end)`);
const groupRef = (g: string) => `case when ${g}.source = 'system' then '@' || ${g}.name else ${g}.source || ':' || ${g}.name end`;
/** JSON array of the sorted group references joined through `table` on `column = owner`. */
const groupsOf = (table: string, column: string, owner: string) =>
  sql.raw(
    `json((select json_group_array(ref) from (select ${groupRef("g")} as ref from "${table}" x join "group" g on g.id = x.group_id where x.${column} = ${owner} order by ref)))`,
  );

/** JSON snapshot of each kind of object, null when it does not exist; the same text before and after the batch. */
export const snapshot = {
  user: (id: string) =>
    sql`(select json_object('name', u.name, 'email', u.email, 'origin', case when exists (select 1 from account a where a.user_id = u.id and a.provider_id = 'credential') then 'local' else 'oidc' end, 'role', u.role, 'roleOverride', u.role_override, 'disabled', ${bool("u.disabled")}, 'mustChangePassword', ${bool("u.must_change_password")}, 'groups', ${groupsOf("user_group", "user_id", "u.id")}) from "user" u where u.id = ${id})`,
  password: (id: string) => sql`(select json_object('mustChangePassword', ${bool("u.must_change_password")}) from "user" u where u.id = ${id})`,
  group: (id: string) => sql`(select json_object('name', g.name, 'source', g.source) from "group" g where g.id = ${id})`,
  /** A group as it is deleted: its members, categories and links go with it. */
  deletedGroup: (id: string) =>
    sql`(select json_object('name', g.name, 'source', g.source, 'members', json((select json_group_array(json_object('id', id, 'name', name)) from (select u.id, u.name from user_group ug join "user" u on u.id = ug.user_id where ug.group_id = g.id order by u.name, u.id))), 'categories', json((select json_group_array(category_id) from (select category_id from category_group where group_id = g.id order by category_id))), 'links', json((select json_group_array(link_id) from (select link_id from link_group where group_id = g.id order by link_id)))) from "group" g where g.id = ${id})`,
  category: (id: string) =>
    sql`(select json_object('title', c.title, 'position', c.position, 'groups', ${groupsOf("category_group", "category_id", "c.id")}) from category c where c.id = ${id})`,
  /** A category as it is deleted: its links go with it, named but not copied whole, to keep the entry small. */
  deletedCategory: (id: string) =>
    sql`(select json_object('title', c.title, 'position', c.position, 'groups', ${groupsOf("category_group", "category_id", "c.id")}, 'links', json((select json_group_array(json_object('id', id, 'title', title)) from (select id, title from link where category_id = c.id order by position, id)))) from category c where c.id = ${id})`,
  link: (id: string) =>
    sql`(select json_object('categoryId', l.category_id, 'title', l.title, 'url', l.url, 'description', l.description, 'icon', l.icon, 'keywords', json(l.keywords), 'active', ${bool("l.active")}, 'check', ${bool("l.check_enabled")}, 'position', l.position, 'groups', ${groupsOf("link_group", "link_id", "l.id")}) from link l where l.id = ${id})`,
};

/** Return the snapshot as stored now, as JSON text, or null when the object does not exist. */
export async function readSnapshot(db: DB, expression: SQL): Promise<string | null> {
  const row = await db.get<{ value: string | null }>(sql`select ${expression} as value`);
  return row?.value ?? null;
}

// Statements below are query builders over raw SQL rather than db.run(): Drizzle's D1 batch cannot bind
// the parameters of a raw statement.

/**
 * Return a statement failing its batch when `condition` holds, whatever the batch wrote before.
 *
 * It inserts a null value into a NOT NULL column when the condition holds, and nothing otherwise, so it
 * needs no row to exist, unlike the catalog's revision guard.
 */
export function failWhen(db: DB, condition: SQL) {
  return db.insert(setting).select(sql`select 'audit.guard', null, 0 where ${condition}`);
}

/** Return the statement failing the batch when the snapshot is no longer `before`: the entry would lie. */
export function unchangedSince(db: DB, expression: SQL, before: string | null) {
  return failWhen(db, sql`${expression} is not ${before}`);
}

export type AuditEntry = {
  action: AuditAction;
  type: AuditObjectType;
  id: string | null;
  /** The name or title of the object; by default read from the snapshots (`name`, else `title`). */
  label?: SQL | string | null;
  /** A second object: the person added to or removed from a group. */
  related?: { type: AuditObjectType; id: string; label: SQL | string };
  /** The snapshot read before the batch, exact when the batch checks it with {@link unchangedSince}. */
  before: string | null;
  /** The snapshot after the write: an expression read inside the batch, or a value. */
  after: SQL | string | null;
  details?: Record<string, unknown>;
  /** When the entry is written; by default, when `after` differs from `before`, so a no-op leaves none. */
  when?: SQL;
};

/**
 * Return the statements writing an audit entry, then purging up to 100 expired ones, for the batch of the write.
 *
 * Put them after the write: `after` reads the result. The actor's name and e-mail are copied as they are
 * at that moment, so the entry still names a person deleted later.
 */
export function auditStatements({ db, actorId, retentionDays }: Auditor, entry: AuditEntry): [unknown, unknown] {
  const after = entry.after === null ? sql`null` : typeof entry.after === "string" ? sql`${entry.after}` : entry.after;
  const label =
    entry.label === undefined
      ? sql`coalesce(json_extract(s.after, '$.name'), json_extract(s.after, '$.title'), json_extract(${entry.before}, '$.name'), json_extract(${entry.before}, '$.title'))`
      : entry.label === null || typeof entry.label === "string"
        ? sql`${entry.label}`
        : entry.label;
  const related = entry.related;
  const relatedLabel = related === undefined ? sql`null` : typeof related.label === "string" ? sql`${related.label}` : related.label;
  const details = entry.details === undefined ? null : JSON.stringify(entry.details);
  // Columns in the order of the table: id, at, actor_id, actor_name, actor_email, action, object_type,
  // object_id, object_label, related_type, related_id, related_label, before, after, details.
  const insert = db.insert(auditLog).select(sql`
    select null, unixepoch() * 1000, ${actorId}, (select name from "user" where id = ${actorId}), (select email from "user" where id = ${actorId}),
      ${entry.action}, ${entry.type}, ${entry.id}, ${label}, ${related?.type ?? null}, ${related?.id ?? null}, ${relatedLabel},
      ${entry.before}, s.after, ${details}
    from (select ${after} as after) as s
    where ${entry.when ?? sql`s.after is not ${entry.before}`}`);
  const purge = db
    .delete(auditLog)
    .where(sql`${auditLog.id} in (select id from audit_log where at < ${retentionStart(retentionDays)} order by id limit 100)`);
  return [insert, purge];
}

/**
 * Run `attempt` until it gives an answer, at most 5 times: it returns "retry" when a snapshot changed
 * between its read and its batch, and must not when `last` is true.
 */
export async function retrying<T>(attempt: (last: boolean) => Promise<T | "retry">): Promise<T> {
  for (let n = 1; ; n++) {
    const result = await attempt(n === 5);
    if (result !== "retry") return result;
  }
}
