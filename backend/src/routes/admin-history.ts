import { and, desc, eq, gte, isNotNull, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";

import { AUDIT_OBJECT_TYPES, type AuditObjectType, retentionStart } from "../audit";
import type { AppEnv } from "../context";
import { apiError } from "../errors";
import { auditLog, user } from "../schema";
import { requireAdmin } from "./require-admin";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;

const actor = alias(user, "actor");

/** Return whether the object an entry names still exists, by its type. */
const objectExists = (type: SQL | string, id: SQL | string): SQL => sql`case ${type}
  when 'user' then exists (select 1 from "user" where id = ${id})
  when 'group' then exists (select 1 from "group" where id = ${id})
  when 'category' then exists (select 1 from category where id = ${id})
  when 'link' then exists (select 1 from link where id = ${id})
  else 0 end`;

const parseJson = (value: string | null): unknown => (value === null ? null : JSON.parse(value));

/** Return the instant in ms, or null when the value is not an ISO 8601 date or date-time. */
function instant(value: string): number | null {
  if (!ISO_INSTANT.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export const adminHistory = new Hono<AppEnv>();

adminHistory.use("*", requireAdmin, async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

/**
 * Return the entries still kept, newest first, filtered by actor (`none` for YASAD itself), object type,
 * object (as the object or the related one) and period (`from` included, `to` excluded); `before` is the
 * cursor `next` of the previous page.
 */
adminHistory.get("/", async (c) => {
  const { db, config } = c.var;
  const q = c.req.query();
  const fields: Record<string, string> = {};
  const where: (SQL | undefined)[] = [gte(auditLog.at, retentionStart(config.auditRetentionDays))];

  if (q.actor) where.push(q.actor === "none" ? isNull(auditLog.actorId) : eq(auditLog.actorId, q.actor));
  if (q.type !== undefined) {
    if (AUDIT_OBJECT_TYPES.includes(q.type as AuditObjectType)) where.push(eq(auditLog.objectType, q.type));
    else fields.type = "invalid_type";
  }
  if (q.object) where.push(or(eq(auditLog.objectId, q.object), eq(auditLog.relatedId, q.object)));
  for (const [name, compare] of [
    ["from", gte],
    ["to", lt],
  ] as const) {
    if (q[name] === undefined) continue;
    const ms = instant(q[name]);
    if (ms === null) fields[name] = "invalid_date";
    else where.push(compare(auditLog.at, ms));
  }
  if (q.before !== undefined) {
    if (/^[1-9]\d{0,15}$/.test(q.before)) where.push(lt(auditLog.id, Number(q.before)));
    else fields.before = "invalid_cursor";
  }
  let limit = DEFAULT_LIMIT;
  if (q.limit !== undefined) {
    if (/^\d{1,3}$/.test(q.limit) && Number(q.limit) >= 1 && Number(q.limit) <= MAX_LIMIT) limit = Number(q.limit);
    else fields.limit = "invalid_limit";
  }
  if (Object.keys(fields).length > 0) return apiError(c, 422, "invalid_input", "Some fields are not valid.", { fields });

  const rows = await db
    .select({
      id: auditLog.id,
      at: auditLog.at,
      actorId: auditLog.actorId,
      actorName: auditLog.actorName,
      actorEmail: auditLog.actorEmail,
      actorExists: sql<number>`${actor.id} is not null`,
      action: auditLog.action,
      objectType: auditLog.objectType,
      objectId: auditLog.objectId,
      objectLabel: auditLog.objectLabel,
      objectExists: sql<number>`${objectExists(sql`${auditLog.objectType}`, sql`${auditLog.objectId}`)}`,
      relatedType: auditLog.relatedType,
      relatedId: auditLog.relatedId,
      relatedLabel: auditLog.relatedLabel,
      relatedExists: sql<number>`${objectExists(sql`${auditLog.relatedType}`, sql`${auditLog.relatedId}`)}`,
      before: auditLog.before,
      after: auditLog.after,
      details: auditLog.details,
    })
    .from(auditLog)
    .leftJoin(actor, eq(actor.id, auditLog.actorId))
    .where(and(...where))
    .orderBy(desc(auditLog.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  return c.json({
    entries: page.map((row) => ({
      id: row.id,
      at: new Date(row.at).toISOString(),
      actor: row.actorId === null ? null : { id: row.actorId, name: row.actorName, email: row.actorEmail, exists: Boolean(row.actorExists) },
      action: row.action,
      object: { type: row.objectType, id: row.objectId, label: row.objectLabel, exists: Boolean(row.objectExists) },
      related: row.relatedType === null ? null : { type: row.relatedType, id: row.relatedId, label: row.relatedLabel, exists: Boolean(row.relatedExists) },
      before: parseJson(row.before),
      after: parseJson(row.after),
      details: parseJson(row.details),
    })),
    next: rows.length > limit ? page[page.length - 1]!.id : null,
  });
});

/**
 * Return the people who wrote the entries still kept, deleted ones included, sorted by name: the current
 * name and e-mail of those who still exist, the latest copied in the log for the others.
 */
adminHistory.get("/actors", async (c) => {
  const { db, config } = c.var;
  const latest = db
    .select({ actorId: auditLog.actorId, id: sql<number>`max(${auditLog.id})`.as("latest_id") })
    .from(auditLog)
    .where(and(isNotNull(auditLog.actorId), gte(auditLog.at, retentionStart(config.auditRetentionDays))))
    .groupBy(auditLog.actorId)
    .as("latest");
  const rows = await db
    .select({ id: latest.actorId, name: sql<string>`coalesce(${actor.name}, ${auditLog.actorName})`, email: sql<string>`coalesce(${actor.email}, ${auditLog.actorEmail})`, exists: sql<number>`${actor.id} is not null` })
    .from(latest)
    .innerJoin(auditLog, eq(auditLog.id, latest.id))
    .leftJoin(actor, eq(actor.id, latest.actorId));
  const actors = rows
    .map((row) => ({ id: row.id!, name: row.name, email: row.email, exists: Boolean(row.exists) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return c.json({ actors });
});
