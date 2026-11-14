import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { auditStatements, readSnapshot, retrying, snapshot, unchangedSince } from "../audit";
import type { AppEnv } from "../context";
import type { DB } from "../db";
import { apiError } from "../errors";
import { imageExists, IMAGE_ID, IMAGE_REF, imageIdOf, purgeOrphans, storedImage, type StoredImage } from "../images/store";
import { setting } from "../schema";
import { type Theme, THEMES } from "../themes";
import { readJson } from "./body";
import { INSTANCE_KEYS, instanceSettings } from "./instance";
import { auditorOf, requireAdmin } from "./require-admin";

/** Longest instance title, in characters after trimming. */
export const MAX_TITLE = 60;

/**
 * The stored settings, null for each default. `legacy` is a logo set outside the app (a path or a data: URI), or a
 * reference whose image is gone: still read, never written again.
 */
export type AdminInstance = {
  title: string | null;
  logo: StoredImage | { legacy: string } | null;
  theme: Theme | null;
};

type Field = keyof typeof INSTANCE_KEYS;
/** A change of each field the body names: the value to store, or null to go back to the default. */
type Changes = Partial<Record<Field, string | null>>;

async function readInstance(db: DB): Promise<AdminInstance> {
  const values = await instanceSettings(db);
  const title = values.get(INSTANCE_KEYS.title)?.trim() || null;
  const theme = THEMES.find((t) => t === values.get(INSTANCE_KEYS.theme)) ?? null;
  const stored = values.get(INSTANCE_KEYS.logo);
  const id = imageIdOf(stored);
  const found = id ? await storedImage(db, id) : null;
  return { title, logo: found ?? (stored ? { legacy: stored } : null), theme };
}

/** Return the changes the body asks for, or the code of each field it cannot store. */
function parseChanges(body: Record<string, unknown>): { changes: Changes } | { fields: Record<string, string> } {
  const changes: Changes = {};
  const fields: Record<string, string> = {};
  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : body.title;
    if (title === null) changes.title = null;
    else if (typeof title === "string" && title.length > 0 && title.length <= MAX_TITLE) changes.title = title;
    else fields.title = "invalid_title";
  }
  if (body.logo !== undefined) {
    if (body.logo === null) changes.logo = null;
    else if (typeof body.logo === "string" && IMAGE_ID.test(body.logo)) changes.logo = `${IMAGE_REF}${body.logo}`;
    else fields.logo = "invalid_logo";
  }
  if (body.theme !== undefined) {
    if (body.theme === null || THEMES.includes(body.theme as Theme)) changes.theme = body.theme as Theme | null;
    else fields.theme = "invalid_theme";
  }
  return Object.keys(fields).length > 0 ? { fields } : { changes };
}

/** Return the statements storing each change: an upsert, or a delete for null. */
function writes(db: DB, changes: Changes) {
  const now = new Date();
  return (Object.entries(changes) as [Field, string | null][]).map(([field, value]) => {
    const key = INSTANCE_KEYS[field];
    return value === null
      ? db.delete(setting).where(eq(setting.key, key))
      : db.insert(setting).values({ key, value, updatedAt: now }).onConflictDoUpdate({ target: setting.key, set: { value, updatedAt: now } });
  });
}

export const adminInstance = new Hono<AppEnv>();

adminInstance.use("*", requireAdmin, async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

adminInstance.get("/", async (c) => c.json(await readInstance(c.var.db)));

/**
 * Change the title, logo or theme; a null field goes back to the default. Two admins saving at once: the last one
 * wins, field by field, and each entry of the log stays exact through `unchangedSince`.
 */
adminInstance.patch("/", async (c) => {
  const { db } = c.var;
  const parsed = parseChanges(await readJson(c));
  if ("fields" in parsed) return apiError(c, 422, "invalid_input", "Some fields are not valid.", { fields: parsed.fields });
  const { changes } = parsed;
  if (Object.keys(changes).length === 0) return c.json(await readInstance(db));
  const logoId = imageIdOf(changes.logo ?? undefined);
  const auditor = await auditorOf(c);
  const current = snapshot.instance();
  return retrying(async (last) => {
    const before = await readSnapshot(db, current);
    try {
      await db.batch([
        unchangedSince(db, current, before),
        ...writes(db, changes),
        ...(logoId ? [imageExists(db, logoId)] : []),
        // A fixed label: the default one would take the title, null once it is cleared.
        ...auditStatements(auditor, { action: "update", type: "instance", id: null, label: null, before, after: current }),
        purgeOrphans(db, Date.now()),
      ]);
    } catch (err) {
      if (logoId && !(await storedImage(db, logoId))) return apiError(c, 422, "unknown_image", "The image is no longer stored; upload it again.");
      if (!last && (await readSnapshot(db, current)) !== before) return "retry";
      throw err;
    }
    return c.json(await readInstance(db));
  });
});
