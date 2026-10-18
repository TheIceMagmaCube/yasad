import { and, eq, gt } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { getSignedCookie } from "hono/cookie";

import { authFor, sessionFor } from "../auth";
import type { Config, OidcConfig } from "../config";
import type { AppEnv } from "../context";
import { apiError } from "../errors";
import { OIDC_PROVIDER_ID, oidcAuth, readDiscovery, signInErrorCode } from "../oidc";
import {
  clearAttempts,
  type Limit,
  OIDC_CALLBACK_LIMIT,
  OIDC_START_LIMIT,
  releaseAttempt,
  reserveAttempt,
  SIGN_IN_ACCOUNT_LIMIT,
  SIGN_IN_IP_LIMIT,
} from "../rate-limit";
import { account, session, user, verification } from "../schema";

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

/** Bound on starting a provider sign-in, discovery and Better Auth start-up included. */
const START_TIMEOUT_MS = 10_000;
/** Bound on the provider's callback: discovery, code exchange, keys and writes. */
const CALLBACK_TIMEOUT_MS = 15_000;
const DISCOVERY_TIMEOUT_MS = 10_000;
const END_SESSION_TIMEOUT_MS = 5_000;

const TIMED_OUT = Symbol("timed out");

/** Return the value of `promise`, or TIMED_OUT when it takes longer than `ms`. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

type OidcEnabled = Config & { oidc: OidcConfig };

const oidcConfig = (c: Context<AppEnv>): OidcEnabled | null => (c.var.config.oidc ? (c.var.config as OidcEnabled) : null);

/** Return the name Better Auth gives one of its cookies. */
const cookieName = (config: Config, name: string) => `${config.publicUrl.startsWith("https://") ? "__Secure-" : ""}better-auth.${name}`;

/**
 * Return the same-origin path to come back to after signing in, or "/".
 *
 * Only a path is kept, never an address another site could be reached through; the sign-in and
 * signed-out pages are not destinations.
 */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || value.startsWith("//")) return "/";
  // Browsers read a backslash as a slash, and URL parsing drops tabs and newlines: "/\t/x" is "//x".
  if ([...value].some((ch) => ch === "\\" || ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return "/";
  const url = new URL(value, "http://yasad.invalid");
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (url.origin !== "http://yasad.invalid" || path.startsWith("//") || /^\/(sign-in|signed-out)(\/|$)/.test(url.pathname)) return "/";
  return path;
}

/**
 * Start a sign-in at the OIDC provider and return the address to send the browser to.
 *
 * The body Better Auth receives is built here: only `returnTo` is read from the request, so an
 * `idToken` sent by a client can never open a session without the Authorization Code flow. Each
 * start writes a `verification` row, so starts are limited per IP.
 */
async function startOidc(c: Context<AppEnv>): Promise<Response> {
  const config = oidcConfig(c);
  if (!config) return c.notFound();
  const { db, clientIp } = c.var;
  const attempt = await reserveAttempt(db, `oidc-start:${clientIp}`, OIDC_START_LIMIT);
  if (!attempt.allowed) {
    c.header("Retry-After", String(Math.ceil(attempt.retryAfterMs / 1000)));
    return apiError(c, 429, "rate_limited", "Too many attempts. Try again later.");
  }

  const body = (await c.req.raw
    .clone()
    .json()
    .catch(() => null)) as { returnTo?: unknown } | null;
  const headers = new Headers(c.req.raw.headers);
  headers.delete("content-length");
  const request = new Request(c.req.url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      provider: OIDC_PROVIDER_ID,
      callbackURL: `${config.publicUrl}${safeReturnTo(body?.returnTo)}`,
      errorCallbackURL: `${config.publicUrl}/sign-in`,
      disableRedirect: true,
    }),
  });

  const res = await within(
    (async () => (await oidcAuth(db, config, DISCOVERY_TIMEOUT_MS))?.handler(request) ?? null)(),
    START_TIMEOUT_MS,
  );
  if (res === TIMED_OUT || res === null) {
    return apiError(c, 503, "provider_unavailable", "The identity provider cannot be reached.");
  }
  if (!res.ok) return res;
  const { url } = (await res.json()) as { url: string };
  for (const cookie of res.headers.getSetCookie()) c.header("set-cookie", cookie, { append: true });
  return c.json({ url });
}

/** Return whether the callback carries the state of a sign-in started in this browser and not used yet. */
async function statePending(c: Context<AppEnv>, config: Config): Promise<boolean> {
  const state = c.req.query("state");
  if (!state) return false;
  const signed = await getSignedCookie(c, config.authSecret, cookieName(config, "state"));
  if (!signed || signed !== state) return false;
  const row = await c.var.db
    .select({ id: verification.id })
    .from(verification)
    .where(and(eq(verification.identifier, `auth-state:${state}`), gt(verification.expiresAt, new Date())))
    .get();
  return row !== undefined;
}

/**
 * Receive the browser back from the provider and finish the sign-in.
 *
 * A callback without a pending state of this browser is refused before anything reaches the
 * provider, and callbacks are limited per IP: each one costs up to three calls to the provider. The
 * whole callback is bounded in time, but the bound does not cancel the work: on Docker a sign-in that
 * outlives it may still write the account, its groups and a session the browser never receives,
 * while the browser is told `provider_unavailable`. Every failure sends the browser to the sign-in
 * page with a code it knows; a server error becomes `sign_in_failed`.
 */
async function oidcCallback(c: Context<AppEnv>): Promise<Response> {
  const config = oidcConfig(c);
  if (!config) return c.notFound();
  const { db, clientIp } = c.var;
  const signInPage = `${config.publicUrl}/sign-in`;
  const refuse = (code: string) => c.redirect(`${signInPage}?error=${code}`, 302);

  if (!(await statePending(c, config))) return refuse("state_mismatch");
  if (!(await reserveAttempt(db, `oidc-callback:${clientIp}`, OIDC_CALLBACK_LIMIT)).allowed) return refuse("rate_limited");

  const res = await within(
    (async () => (await oidcAuth(db, config, DISCOVERY_TIMEOUT_MS))?.handler(c.req.raw) ?? null)(),
    CALLBACK_TIMEOUT_MS,
  );
  if (res === TIMED_OUT || res === null) return refuse("provider_unavailable");
  if (res.status >= 500) {
    console.error(`OIDC callback answered ${res.status}: ${await res.text().catch(() => "")}`);
    return refuse("sign_in_failed");
  }
  const location = res.headers.get("location");
  if (res.status < 300 || res.status >= 400 || !location) return refuse("sign_in_failed");

  const target = new URL(location, config.publicUrl);
  const sameOrigin = target.origin === new URL(config.publicUrl).origin;
  const sessionSet = res.headers.getSetCookie().some((cookie) => cookie.startsWith(`${cookieName(config, "session_token")}=`) && !/max-age=0/i.test(cookie));
  if (sessionSet && sameOrigin && target.pathname !== "/sign-in") return res;

  const code = sameOrigin && target.pathname === "/sign-in" ? target.searchParams.get("error") : null;
  const headers = new Headers(res.headers);
  headers.set("location", `${signInPage}?error=${signInErrorCode(code)}`);
  return new Response(null, { status: 302, headers });
}

/** Return the provider's end-session address for this ID token, or null when it offers none or cannot be reached. */
async function endSessionUrl(config: OidcEnabled, idToken: string | null): Promise<string | null> {
  const endpoint = (await readDiscovery(config.oidc.discoveryUrl, config.publicUrl, END_SESSION_TIMEOUT_MS))?.end_session_endpoint;
  if (!endpoint) return null;
  const url = new URL(endpoint);
  if (idToken) url.searchParams.set("id_token_hint", idToken);
  url.searchParams.set("post_logout_redirect_uri", `${config.publicUrl}/signed-out`);
  url.searchParams.set("client_id", config.oidc.clientId);
  return url.toString();
}

/**
 * Sign out, and for an OIDC account add the provider's end-session address as `url`.
 *
 * The local session is deleted first by the common instance; the provider is asked only afterwards,
 * so a provider that is down never keeps anyone signed in.
 */
async function signOut(c: Context<AppEnv>): Promise<Response> {
  const config = oidcConfig(c);
  const current = config ? await sessionFor(c) : null;
  const oidcAccount = current
    ? await c.var.db
        .select({ idToken: account.idToken })
        .from(account)
        .where(and(eq(account.userId, current.user.id), eq(account.providerId, OIDC_PROVIDER_ID)))
        .get()
    : undefined;
  const res = await authFor(c).handler(c.req.raw);
  if (!config || !oidcAccount || !res.ok) return res;
  const url = await endSessionUrl(config, oidcAccount.idToken);
  if (!url) return res;
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify({ success: true, url }), { status: 200, headers });
}

/** Better Auth routes YASAD uses; every other /api/auth path answers 404. */
export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/get-session", (c) => authFor(c).handler(c.req.raw));
authRoutes.post("/sign-out", signOut);
authRoutes.post("/sign-in/email", signIn);
authRoutes.post("/sign-in/social", startOidc);
authRoutes.get(`/callback/${OIDC_PROVIDER_ID}`, oidcCallback);
