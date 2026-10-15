import { and, asc, eq, exists, ne, type SQL } from "drizzle-orm";
import { type Context, Hono } from "hono";

import { authFor } from "../auth";
import type { AppEnv } from "../context";
import type { DB } from "../db";
import { apiError } from "../errors";
import { account, group, session, user, userGroup } from "../schema";
import { temporaryPassword } from "../temporary-password";
import { requireAdmin } from "./require-admin";
import { EMAIL } from "./setup";

type Role = "admin" | "user";

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  origin: "local" | "oidc";
  role: Role;
  /** Where the role comes from: set in YASAD for a local account, forced or given by the provider for OIDC. */
  roleSource: "local" | "override" | "provider";
  roleOverride: Role | null;
  disabled: boolean;
  mustChangePassword: boolean;
  groups: { id: string; name: string; source: "oidc" | "local" | "system" }[];
  lastSignInAt: string | null;
};

const isRole = (v: unknown): v is Role => v === "admin" || v === "user";

async function readJson(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  return body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

/** Return the users with their origin and groups, sorted by name, or only the one with `id`. */
async function listUsers(db: DB, id?: string): Promise<AdminUser[]> {
  const where = id === undefined ? undefined : eq(user.id, id);
  const [users, accounts, memberships] = await Promise.all([
    db.select().from(user).where(where).orderBy(asc(user.name), asc(user.email)),
    db.select({ userId: account.userId, providerId: account.providerId }).from(account).where(id === undefined ? undefined : eq(account.userId, id)),
    db
      .select({ userId: userGroup.userId, id: group.id, name: group.name, source: group.source })
      .from(userGroup)
      .innerJoin(group, eq(group.id, userGroup.groupId))
      .where(id === undefined ? undefined : eq(userGroup.userId, id))
      .orderBy(asc(group.name)),
  ]);
  const local = new Set(accounts.filter((a) => a.providerId === "credential").map((a) => a.userId));
  return users.map((u) => {
    const origin = local.has(u.id) ? "local" : "oidc";
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      origin,
      role: u.role === "admin" ? "admin" : "user",
      roleSource: origin === "local" ? "local" : u.roleOverride ? "override" : "provider",
      roleOverride: u.roleOverride,
      disabled: u.disabled,
      mustChangePassword: u.mustChangePassword,
      groups: memberships.filter((m) => m.userId === u.id).map(({ id, name, source }) => ({ id, name, source })),
      lastSignInAt: u.lastSignInAt?.toISOString() ?? null,
    };
  });
}

/** Return a query selecting the enabled local admins other than `id`, usable as a subquery. */
function otherActiveLocalAdmins(db: DB, id: string) {
  return db
    .select({ id: user.id })
    .from(user)
    .innerJoin(account, eq(account.userId, user.id))
    .where(and(eq(user.role, "admin"), eq(user.disabled, false), eq(account.providerId, "credential"), ne(user.id, id)));
}

const isActiveLocalAdmin = (u: AdminUser) => u.origin === "local" && u.role === "admin" && !u.disabled;

/** Validate a name and an e-mail; return the normalized values or an error code per invalid field. */
function parseIdentity(body: Record<string, unknown>, fields: Record<string, string>) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (name.length === 0 || name.length > 100) fields.name = "invalid_name";
  if (!EMAIL.test(email)) fields.email = "invalid_email";
  return { name, email };
}

export const adminUsers = new Hono<AppEnv>();

adminUsers.use("*", requireAdmin);

adminUsers.get("/", async (c) => c.json({ users: await listUsers(c.var.db) }));

/** Create a local account with a temporary password, returned once and to be changed at first sign-in. */
adminUsers.post("/", async (c) => {
  const { db } = c.var;
  const body = await readJson(c);
  const fields: Record<string, string> = {};
  const { name, email } = parseIdentity(body, fields);
  const role = body.role === undefined ? "user" : body.role;
  if (!isRole(role)) fields.role = "invalid_role";
  if (Object.keys(fields).length > 0) return apiError(c, 422, "invalid_input", "Some fields are not valid.", { fields });

  const emailTaken = async () => (await db.select({ id: user.id }).from(user).where(eq(user.email, email)).get()) !== undefined;
  const taken = () => apiError(c, 422, "invalid_input", "Some fields are not valid.", { fields: { email: "email_taken" } });
  if (await emailTaken()) return taken();

  const password = temporaryPassword();
  const hash = await (await authFor(c).$context).password.hash(password);
  const now = new Date();
  const id = crypto.randomUUID();
  try {
    await db.batch([
      db.insert(user).values({ id, name, email, role: role as Role, mustChangePassword: true, createdAt: now, updatedAt: now }),
      db.insert(account).values({ id: crypto.randomUUID(), accountId: id, providerId: "credential", userId: id, password: hash, createdAt: now, updatedAt: now }),
    ]);
  } catch (err) {
    if (await emailTaken()) return taken();
    throw err;
  }
  return c.json({ user: (await listUsers(db, id))[0], temporaryPassword: password }, 201);
});

/**
 * Change a user's name, role or disabled state.
 *
 * `role` applies to local accounts; `roleOverride` (admin, user or null to follow the provider) to OIDC
 * accounts, and sets the role at once when not null. Disabling closes every session. An admin cannot
 * change their own role or disable themselves, and the last enabled local admin stays one.
 */
adminUsers.patch("/:id", async (c) => {
  const { db } = c.var;
  const id = c.req.param("id");
  const [target] = await listUsers(db, id);
  if (!target) return apiError(c, 404, "not_found", "No such user.");
  const body = await readJson(c);

  const fields: Record<string, string> = {};
  const name = body.name === undefined ? undefined : typeof body.name === "string" ? body.name.trim() : "";
  if (name !== undefined && (name.length === 0 || name.length > 100)) fields.name = "invalid_name";
  if (body.role !== undefined && (!isRole(body.role) || target.origin !== "local")) fields.role = "invalid_role";
  if (body.roleOverride !== undefined && ((body.roleOverride !== null && !isRole(body.roleOverride)) || target.origin !== "oidc")) {
    fields.roleOverride = "invalid_role";
  }
  if (body.disabled !== undefined && typeof body.disabled !== "boolean") fields.disabled = "invalid_value";
  if (Object.keys(fields).length > 0) return apiError(c, 422, "invalid_input", "Some fields are not valid.", { fields });

  const role = (body.role as Role | undefined) ?? (body.roleOverride === undefined ? undefined : ((body.roleOverride as Role | null) ?? undefined));
  const disabled = body.disabled as boolean | undefined;
  const current = await authFor(c).api.getSession({ headers: c.req.raw.headers });
  if (current?.user.id === id && ((role !== undefined && role !== target.role) || body.roleOverride !== undefined || disabled === true)) {
    return apiError(c, 409, "cannot_change_self", "You cannot change your own role or disable yourself.");
  }

  const demotes = isActiveLocalAdmin(target) && (role === "user" || disabled === true);

  // Checked inside the write, so two admins demoting each other cannot both succeed.
  const guard: SQL | undefined = demotes ? exists(otherActiveLocalAdmins(db, id)) : undefined;
  const now = new Date();
  await db.batch([
    db
      .update(user)
      .set({
        updatedAt: now,
        ...(name !== undefined && { name }),
        ...(role !== undefined && { role }),
        ...(body.roleOverride !== undefined && { roleOverride: body.roleOverride as Role | null }),
        ...(disabled !== undefined && { disabled }),
      })
      .where(and(eq(user.id, id), guard)),
    db.delete(session).where(and(eq(session.userId, id), exists(db.select({ id: user.id }).from(user).where(and(eq(user.id, id), eq(user.disabled, true)))))),
  ]);
  const [updated] = await listUsers(db, id);
  if (demotes && isActiveLocalAdmin(updated!)) return apiError(c, 409, "last_local_admin", "Keep at least one enabled local administrator.");
  return c.json({ user: updated });
});

/** Give a local account a new temporary password, returned once, and close its sessions. */
adminUsers.post("/:id/password", async (c) => {
  const { db } = c.var;
  const id = c.req.param("id");
  const [target] = await listUsers(db, id);
  if (!target) return apiError(c, 404, "not_found", "No such user.");
  if (target.origin !== "local") return apiError(c, 409, "no_local_password", "This account has no local password.");

  const password = temporaryPassword();
  const hash = await (await authFor(c).$context).password.hash(password);
  const now = new Date();
  await db.batch([
    db
      .update(account)
      .set({ password: hash, updatedAt: now })
      .where(and(eq(account.userId, id), eq(account.providerId, "credential"))),
    db.update(user).set({ mustChangePassword: true, updatedAt: now }).where(eq(user.id, id)),
    db.delete(session).where(eq(session.userId, id)),
  ]);
  return c.json({ temporaryPassword: password });
});

/** Delete a user with their sessions, accounts and memberships. Not oneself, nor the last enabled local admin. */
adminUsers.delete("/:id", async (c) => {
  const { db } = c.var;
  const id = c.req.param("id");
  const [target] = await listUsers(db, id);
  if (!target) return apiError(c, 404, "not_found", "No such user.");
  const current = await authFor(c).api.getSession({ headers: c.req.raw.headers });
  if (current?.user.id === id) return apiError(c, 409, "cannot_change_self", "You cannot delete yourself.");

  const demotes = isActiveLocalAdmin(target);

  // Checked inside the write, like the role change; sessions, accounts and memberships cascade.
  await db.delete(user).where(and(eq(user.id, id), demotes ? exists(otherActiveLocalAdmins(db, id)) : undefined));
  if ((await listUsers(db, id)).length > 0) return apiError(c, 409, "last_local_admin", "Keep at least one enabled local administrator.");
  return c.body(null, 204);
});
