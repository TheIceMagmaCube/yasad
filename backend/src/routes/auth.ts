import { and, eq } from "drizzle-orm";
import { type Context, Hono } from "hono";

import { authFor } from "../auth";
import type { AppEnv } from "../context";
import { apiError } from "../errors";
import { clearFailures, failuresInWindow, type Limit, recordFailure, SIGN_IN_ACCOUNT_LIMIT, SIGN_IN_IP_LIMIT } from "../rate-limit";
import { account, user } from "../schema";

/** Body Better Auth sends for a wrong e-mail or password; reused so a refusal never stands out. */
export const INVALID_CREDENTIALS = { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" };

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
 * Sign in with e-mail and password, limited per IP and e-mail and per IP.
 *
 * The limits are checked before the password, so a right password is refused too while blocked.
 * With PASSWORD_SIGN_IN=false only local admins may sign in; every other refusal gets the same
 * answer as a wrong password, after hashing the password so the timing matches too.
 */
async function signIn(c: Context<AppEnv>): Promise<Response> {
  const { db, config, clientIp } = c.var;
  const body: unknown = await c.req.raw
    .clone()
    .json()
    .catch(() => null);
  const fields = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const email = typeof fields.email === "string" ? fields.email.trim().toLowerCase() : "";
  const keys: [string, Limit][] = [
    [`signin:${clientIp}:${email}`, SIGN_IN_ACCOUNT_LIMIT],
    [`signin:${clientIp}`, SIGN_IN_IP_LIMIT],
  ];

  const windows = await Promise.all(keys.map(([key, limit]) => failuresInWindow(db, key, limit)));
  const blocked = windows.filter((w, i) => w.count >= keys[i]![1].max);
  if (blocked.length > 0) {
    c.header("Retry-After", String(Math.ceil(Math.max(...blocked.map((w) => w.retryAfterMs)) / 1000)));
    return apiError(c, 429, "rate_limited", "Too many attempts. Try again later.");
  }

  const auth = authFor(c);
  let res: Response;
  if (!config.passwordSignIn && !(await isLocalAdmin(c, email))) {
    await (await auth.$context).password.hash(typeof fields.password === "string" ? fields.password : "");
    res = c.json(INVALID_CREDENTIALS, 401);
  } else {
    res = await auth.handler(c.req.raw);
  }

  if (res.status === 401 || res.status === 403) {
    await Promise.all(keys.map(([key, limit]) => recordFailure(db, key, limit)));
  } else if (res.ok) {
    await clearFailures(db, keys[0]![0]);
  }
  return res;
}

/** Better Auth routes YASAD uses; every other /api/auth path answers 404. */
export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/get-session", (c) => authFor(c).handler(c.req.raw));
authRoutes.post("/sign-out", (c) => authFor(c).handler(c.req.raw));
authRoutes.post("/sign-in/email", signIn);
