import { and, eq, ne } from "drizzle-orm";
import { type Context, Hono } from "hono";

import { authFor, MAX_PASSWORD, MIN_PASSWORD } from "../auth";
import type { AppEnv } from "../context";
import type { DB } from "../db";
import { apiError } from "../errors";
import { PASSWORD_CHANGE_LIMIT, releaseAttempt, reserveAttempt } from "../rate-limit";
import { account, session, user } from "../schema";
import { emailTaken } from "./admin-users";
import { EMAIL } from "./setup";

export const accountRoutes = new Hono<AppEnv>();

/** Return the password account of a user, or undefined for an account known only through the identity provider. */
const localCredential = (db: DB, userId: string) =>
  db
    .select({ id: account.id, password: account.password })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
    .get();

/** Return the request body as an object, or an empty one when it is not a JSON object. */
async function readFields(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  return body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

/** Return how the signed-in user signs in: `local` with a YASAD password, `oidc` through the identity provider. */
accountRoutes.get("/", async (c) => {
  const current = await authFor(c).api.getSession({ headers: c.req.raw.headers });
  if (!current) return apiError(c, 401, "unauthenticated", "Sign in first.");
  const credential = await localCredential(c.var.db, current.user.id);
  return c.json({ origin: credential?.password ? "local" : "oidc" });
});

/**
 * Change the signed-in user's name or e-mail; local accounts only, as the identity provider owns the profile of
 * the others.
 *
 * A new e-mail needs the current password, counted like a password change, and must not belong to another
 * account. Answer the updated profile.
 */
accountRoutes.patch("/", async (c) => {
  const { db } = c.var;
  const auth = authFor(c);
  const current = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!current) return apiError(c, 401, "unauthenticated", "Sign in first.");
  const userId = current.user.id;
  const credential = await localCredential(db, userId);
  if (!credential?.password) return apiError(c, 409, "profile_from_provider", "The identity provider owns this profile.");

  const body = await readFields(c);
  const fields: Record<string, string> = {};
  const name = body.name === undefined ? undefined : typeof body.name === "string" ? body.name.trim() : "";
  if (name !== undefined && (name.length === 0 || name.length > 100)) fields.name = "invalid_name";
  const email = body.email === undefined ? undefined : typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const emailChanges = email !== undefined && email !== current.user.email;
  if (emailChanges && !EMAIL.test(email)) fields.email = "invalid_email";
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  if (emailChanges && currentPassword === "") fields.currentPassword = "required";
  if (Object.keys(fields).length > 0) return apiError(c, 422, "invalid_input", "Some fields are not valid.", { fields });

  const taken = () => apiError(c, 422, "invalid_input", "Some fields are not valid.", { fields: { email: "email_taken" } });
  if (emailChanges) {
    // The password comes first, so a session alone cannot tell which addresses have an account.
    const key = `password:${userId}`;
    const attempt = await reserveAttempt(db, key, PASSWORD_CHANGE_LIMIT);
    if (!attempt.allowed) {
      c.header("Retry-After", String(Math.ceil(attempt.retryAfterMs / 1000)));
      return apiError(c, 429, "rate_limited", "Too many attempts. Try again later.");
    }
    const { password } = await auth.$context;
    if (!(await password.verify({ hash: credential.password, password: currentPassword }))) {
      return apiError(c, 403, "invalid_password", "The current password is not correct.");
    }
    await releaseAttempt(db, key);
    if (await emailTaken(db, email, userId)) return taken();
  }

  try {
    await db
      .update(user)
      .set({ updatedAt: new Date(), ...(name !== undefined && { name }), ...(emailChanges && { email }) })
      .where(eq(user.id, userId));
  } catch (err) {
    if (emailChanges && (await emailTaken(db, email, userId))) return taken();
    throw err;
  }
  const updated = await db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(eq(user.id, userId)).get();
  return c.json({ user: updated });
});

/**
 * Change the signed-in user's local password.
 *
 * Needs the current password. On success the temporary-password flag is cleared and every other
 * session of the account is closed; the current one stays open.
 */
accountRoutes.post("/password", async (c) => {
  const { db } = c.var;
  const auth = authFor(c);
  const current = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!current) return apiError(c, 401, "unauthenticated", "Sign in first.");
  const userId = current.user.id;

  const fields = await readFields(c);
  const currentPassword = typeof fields.currentPassword === "string" ? fields.currentPassword : "";
  const newPassword = typeof fields.newPassword === "string" ? fields.newPassword : "";
  if (newPassword.length < MIN_PASSWORD || newPassword.length > MAX_PASSWORD) {
    return apiError(c, 422, "invalid_input", "Some fields are not valid.", { fields: { newPassword: "invalid_password" } });
  }
  if (newPassword === currentPassword) {
    return apiError(c, 422, "invalid_input", "Some fields are not valid.", { fields: { newPassword: "password_unchanged" } });
  }

  const key = `password:${userId}`;
  const attempt = await reserveAttempt(db, key, PASSWORD_CHANGE_LIMIT);
  if (!attempt.allowed) {
    c.header("Retry-After", String(Math.ceil(attempt.retryAfterMs / 1000)));
    return apiError(c, 429, "rate_limited", "Too many attempts. Try again later.");
  }

  const credential = await localCredential(db, userId);
  if (!credential?.password) {
    await releaseAttempt(db, key);
    return apiError(c, 409, "no_local_password", "This account has no local password.");
  }

  const { password } = await auth.$context;
  if (!(await password.verify({ hash: credential.password, password: currentPassword }))) {
    return apiError(c, 403, "invalid_password", "The current password is not correct.");
  }
  await releaseAttempt(db, key);

  const hash = await password.hash(newPassword);
  const now = new Date();
  await db.batch([
    db.update(account).set({ password: hash, updatedAt: now }).where(eq(account.id, credential.id)),
    db.update(user).set({ mustChangePassword: false, updatedAt: now }).where(eq(user.id, userId)),
    db.delete(session).where(and(eq(session.userId, userId), ne(session.id, current.session.id))),
  ]);
  return c.body(null, 204);
});
