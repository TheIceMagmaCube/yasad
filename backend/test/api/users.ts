import { BASE_ENV, type TestApp } from "#harness";
import { hashPassword } from "better-auth/crypto";

export const PASSWORD = "correct horse battery";

type NewUser = { id: string; email: string; role?: "admin" | "user"; mustChangePassword?: boolean; password?: string };

/** Insert a local user with a password account straight into the database, with a known password. */
export async function addUser(app: TestApp, { id, email, role = "user", mustChangePassword = false, password = PASSWORD }: NewUser) {
  const hash = await hashPassword(password);
  await app.exec(
    `insert into "user" (id, name, email, role, must_change_password) values ('${id}', '${id}', '${email}', '${role}', ${mustChangePassword ? 1 : 0})`,
  );
  await app.exec(
    `insert into account (id, account_id, provider_id, user_id, password) values ('acc-${id}', '${id}', 'credential', '${id}', '${hash}')`,
  );
}

/** Post JSON to the app, optionally from another client IP. */
export function post(app: TestApp, path: string, body: unknown, ip?: string) {
  return app.request(path, { method: "POST", body: JSON.stringify(body), headers: ip ? { "cf-connecting-ip": ip } : {} });
}

export const signIn = (app: TestApp, email: string, password = PASSWORD, ip?: string) =>
  post(app, "/api/auth/sign-in/email", { email, password }, ip);

/**
 * Insert a user known only through the identity provider: an account without a password.
 *
 * Its account id is `<issuer>|<sub>` for the fake provider's default issuer and the subject `sub-<id>`.
 */
export async function addOidcUser(app: TestApp, { id, email, role = "user" }: { id: string; email: string; role?: "admin" | "user" }) {
  await app.exec(`insert into "user" (id, name, email, role) values ('${id}', '${id}', '${email}', '${role}')`);
  await app.exec(`insert into account (id, account_id, provider_id, user_id) values ('acc-${id}', 'https://idp.test|sub-${id}', 'oidc', '${id}')`);
}

/** Send JSON with any method; state-changing requests always carry a JSON body, even an empty one. */
export function send(app: TestApp, method: string, path: string, body: unknown = {}) {
  return app.request(path, method === "GET" ? {} : { method, body: JSON.stringify(body) });
}

/** Return a Better Auth session cookie value: the token signed with AUTH_SECRET (HMAC-SHA256, base64). */
export async function signedCookie(token: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(BASE_ENV.AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  const base64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return encodeURIComponent(`${token}.${base64}`);
}

/**
 * Give a user a session straight in the database, as an OIDC account cannot sign in by password in tests, and
 * return the cookie header that carries it.
 */
export async function sessionCookie(app: TestApp, userId: string): Promise<string> {
  const token = `token-${userId}`;
  await app.exec(`insert into session (id, expires_at, token, user_id) values ('s-${userId}', ${Date.now() + 3_600_000}, '${token}', '${userId}')`);
  return `__Secure-better-auth.session_token=${await signedCookie(token)}`;
}
