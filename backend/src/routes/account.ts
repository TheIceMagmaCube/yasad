import { and, eq, ne } from "drizzle-orm";
import { Hono } from "hono";

import { authFor, MAX_PASSWORD, MIN_PASSWORD } from "../auth";
import type { AppEnv } from "../context";
import { apiError } from "../errors";
import { failuresInWindow, PASSWORD_CHANGE_LIMIT, recordFailure } from "../rate-limit";
import { account, session, user } from "../schema";

export const accountRoutes = new Hono<AppEnv>();

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

  const body: unknown = await c.req.json().catch(() => null);
  const fields = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const currentPassword = typeof fields.currentPassword === "string" ? fields.currentPassword : "";
  const newPassword = typeof fields.newPassword === "string" ? fields.newPassword : "";
  if (newPassword.length < MIN_PASSWORD || newPassword.length > MAX_PASSWORD) {
    return apiError(c, 422, "invalid_input", "Some fields are not valid.", { fields: { newPassword: "invalid_password" } });
  }
  if (newPassword === currentPassword) {
    return apiError(c, 422, "invalid_input", "Some fields are not valid.", { fields: { newPassword: "password_unchanged" } });
  }

  const key = `password:${userId}`;
  const { count, retryAfterMs } = await failuresInWindow(db, key, PASSWORD_CHANGE_LIMIT);
  if (count >= PASSWORD_CHANGE_LIMIT.max) {
    c.header("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
    return apiError(c, 429, "rate_limited", "Too many attempts. Try again later.");
  }

  const credential = await db
    .select({ id: account.id, password: account.password })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
    .get();
  if (!credential?.password) return apiError(c, 409, "no_local_password", "This account has no local password.");

  const { password } = await auth.$context;
  if (!(await password.verify({ hash: credential.password, password: currentPassword }))) {
    await recordFailure(db, key, PASSWORD_CHANGE_LIMIT);
    return apiError(c, 403, "invalid_password", "The current password is not correct.");
  }

  const hash = await password.hash(newPassword);
  const now = new Date();
  await db.batch([
    db.update(account).set({ password: hash, updatedAt: now }).where(eq(account.id, credential.id)),
    db.update(user).set({ mustChangePassword: false, updatedAt: now }).where(eq(user.id, userId)),
    db.delete(session).where(and(eq(session.userId, userId), ne(session.id, current.session.id))),
  ]);
  return c.body(null, 204);
});
