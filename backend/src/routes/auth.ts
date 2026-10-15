import { and, eq } from "drizzle-orm";
import { type Context, Hono } from "hono";

import { authFor } from "../auth";
import type { AppEnv } from "../context";
import { apiError } from "../errors";
import { clearAttempts, type Limit, releaseAttempt, reserveAttempt, SIGN_IN_ACCOUNT_LIMIT, SIGN_IN_IP_LIMIT } from "../rate-limit";
import { account, session, user } from "../schema";

/** Address that never matches an account (".invalid" is reserved), used to refuse a sign-in the way Better Auth does. */
const NO_ACCOUNT = "password-sign-in-disabled@yasad.invalid";

/** Return whether the e-mail belongs to an admin with a local password account. */
async function isLocalAdmin(c: Context<AppEnv>, email: string): Promise<boolean> {
  const row = await c.var.db
    .select({ id: user.id })
    .from(user)
    .innerJoin(account, eq(account.userId, user.id))
    .where(and(eq(user.email, email), eq(user.role, "admin"), eq(account.providerId, "credential")))
    .get();
  return row !== undefined;
}

/**
 * Return the 403 refusing a successful sign-in of a disabled account, after deleting its new session.
 *
 * Checked only once Better Auth accepted the password, so a wrong password still gets the usual 401
 * and a disabled account cannot be told apart without its password.
 */
async function refuseDisabled(c: Context<AppEnv>, res: Response): Promise<Response | null> {
  const body = (await res.clone().json().catch(() => null)) as { token?: string; user?: { id?: string } } | null;
  if (!body?.user?.id || !body.token) return null;
  const row = await c.var.db.select({ disabled: user.disabled }).from(user).where(eq(user.id, body.user.id)).get();
  if (!row?.disabled) return null;
  await c.var.db.delete(session).where(eq(session.token, body.token));
  return apiError(c, 403, "account_disabled", "This account is disabled.");
}

/**
 * Sign in with e-mail and password, limited per IP and e-mail and per IP.
 *
 * Each attempt is counted before the password is checked (a right password is refused too while
 * blocked) and given back only when it succeeds or the server fails. With PASSWORD_SIGN_IN=false only
 * local admins may sign in: any other request goes to Better Auth with an address that matches no
 * account, so its validation errors, its timing and its 401 are exactly those of a wrong password.
 * A disabled account is refused after its password is checked, and the attempt stays counted.
 */
async function signIn(c: Context<AppEnv>): Promise<Response> {
  const { db, config, clientIp } = c.var;
  const body: unknown = await c.req.raw
    .clone()
    .json()
    .catch(() => null);
  const fields = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const rawEmail = typeof fields.email === "string" ? fields.email : "";
  const keys: [string, Limit][] = [
    [`signin:${clientIp}:${rawEmail.trim().toLowerCase()}`, SIGN_IN_ACCOUNT_LIMIT],
    [`signin:${clientIp}`, SIGN_IN_IP_LIMIT],
  ];

  const attempts = await Promise.all(keys.map(([key, limit]) => reserveAttempt(db, key, limit)));
  const blocked = attempts.filter((a) => !a.allowed);
  if (blocked.length > 0) {
    c.header("Retry-After", String(Math.ceil(Math.max(...blocked.map((a) => a.retryAfterMs)) / 1000)));
    return apiError(c, 429, "rate_limited", "Too many attempts. Try again later.");
  }

  // Same lookup as Better Auth (lower-cased, not trimmed), so both agree on who is an admin.
  let request = c.req.raw;
  if (!config.passwordSignIn && !(await isLocalAdmin(c, rawEmail.toLowerCase()))) {
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    request = new Request(request.url, { method: "POST", headers, body: JSON.stringify({ ...fields, email: NO_ACCOUNT }) });
  }
  const res = await authFor(c).handler(request);

  if (res.ok) {
    const refused = await refuseDisabled(c, res);
    if (refused) return refused;
    await Promise.all([clearAttempts(db, keys[0]![0]), releaseAttempt(db, keys[1]![0])]);
  } else if (res.status >= 500) {
    await Promise.all(keys.map(([key]) => releaseAttempt(db, key)));
  }
  return res;
}

/** Better Auth routes YASAD uses; every other /api/auth path answers 404. */
export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/get-session", (c) => authFor(c).handler(c.req.raw));
authRoutes.post("/sign-out", (c) => authFor(c).handler(c.req.raw));
authRoutes.post("/sign-in/email", signIn);
