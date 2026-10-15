import { and, eq, notExists } from "drizzle-orm";
import { type Context, Hono } from "hono";

import { authFor, MAX_PASSWORD, MIN_PASSWORD } from "../auth";
import type { AppEnv } from "../context";
import { apiError } from "../errors";
import { failuresInWindow, recordFailure, SETUP_LIMIT } from "../rate-limit";
import { account, setting, user } from "../schema";
import { codesMatch, hasLocalAdmin, isSetupOpen, localAdmins, SETUP_CODE_STILL_SET } from "../setup-state";

const SETUP_MARKER = "setup.completed";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type AdminInput = { name: string; email: string; password: string };

async function readJson(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  return body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

/**
 * Return the response refusing the setup code, or null when setup is open and the code is right.
 *
 * Checks in order: setup closed (404), too many failures (429), wrong code (403, counted).
 */
async function refuseCode(c: Context<AppEnv>, code: unknown): Promise<Response | null> {
  const { db, config, clientIp } = c.var;
  if (!(await isSetupOpen(db, config))) {
    if (config.setupCode !== null) console.warn(SETUP_CODE_STILL_SET);
    return apiError(c, 404, "setup_closed", "Setup is closed.");
  }

  const key = `setup:${clientIp}`;
  const { count, retryAfterMs } = await failuresInWindow(db, key, SETUP_LIMIT);
  if (count >= SETUP_LIMIT.max) {
    c.header("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
    return apiError(c, 429, "rate_limited", "Too many attempts. Try again later.");
  }

  if (typeof code !== "string" || !(await codesMatch(code.trim(), config.setupCode!))) {
    const failures = await recordFailure(db, key, SETUP_LIMIT);
    return apiError(c, 403, "invalid_code", "This setup code is not valid.", {
      attemptsLeft: Math.max(0, SETUP_LIMIT.max - failures),
    });
  }
  return null;
}

/** Validate the admin fields; return the normalized values or a message per invalid field. */
function parseAdmin(body: Record<string, unknown>): { value: AdminInput } | { fields: Record<string, string> } {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const name = text(body.name).trim();
  const email = text(body.email).trim().toLowerCase();
  const password = text(body.password);
  const fields: Record<string, string> = {};
  if (name.length === 0 || name.length > 100) fields.name = "Enter a name of 1 to 100 characters.";
  if (!EMAIL.test(email)) fields.email = "Enter a valid e-mail address.";
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    fields.password = `Use ${MIN_PASSWORD} to ${MAX_PASSWORD} characters.`;
  }
  if (text(body.passwordConfirm) !== password) fields.passwordConfirm = "The passwords do not match.";
  return Object.keys(fields).length > 0 ? { fields } : { value: { name, email, password } };
}

export const setup = new Hono<AppEnv>();

setup.get("/", async (c) => {
  const open = await isSetupOpen(c.var.db, c.var.config);
  const session = await authFor(c).api.getSession({ headers: c.req.raw.headers });
  if (session?.user.role === "admin") return c.json({ open, setupCodeStillSet: c.var.config.setupCode !== null });
  return c.json({ open });
});

setup.post("/verify-code", async (c) => {
  const body = await readJson(c);
  return (await refuseCode(c, body.code)) ?? c.body(null, 204);
});

setup.post("/", async (c) => {
  const body = await readJson(c);
  const refused = await refuseCode(c, body.code);
  if (refused) return refused;

  const parsed = parseAdmin(body);
  if ("fields" in parsed) return apiError(c, 422, "invalid_input", "Some fields are not valid.", { fields: parsed.fields });
  const { name, email, password } = parsed.value;

  const { db } = c.var;
  if (await db.select({ id: user.id }).from(user).where(eq(user.email, email)).get()) {
    return apiError(c, 422, "invalid_input", "Some fields are not valid.", {
      fields: { email: "This e-mail address is already used by another account." },
    });
  }

  const auth = authFor(c);
  const hash = await (await auth.$context).password.hash(password);
  const now = new Date();
  const userId = crypto.randomUUID();
  // One transaction. A marker left without a local admin is cleared; a concurrent setup that
  // committed first keeps its marker, so the insert below fails and this batch rolls back.
  try {
    await db.batch([
      db.delete(setting).where(and(eq(setting.key, SETUP_MARKER), notExists(localAdmins(db)))),
      db.insert(setting).values({ key: SETUP_MARKER, value: now.toISOString(), updatedAt: now }),
      db.insert(user).values({ id: userId, name, email, role: "admin", createdAt: now, updatedAt: now }),
      db.insert(account).values({
        id: crypto.randomUUID(),
        accountId: userId,
        providerId: "credential",
        userId,
        password: hash,
        createdAt: now,
        updatedAt: now,
      }),
    ]);
  } catch (err) {
    if (await hasLocalAdmin(db)) return apiError(c, 409, "setup_closed", "Setup was just completed by another request.");
    throw err;
  }

  const signIn = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  const res = c.json({ user: { name, email } }, 201);
  for (const cookie of signIn.headers.getSetCookie()) res.headers.append("Set-Cookie", cookie);
  return res;
});
