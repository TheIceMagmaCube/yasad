import type { TestApp } from "#harness";
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

/** Insert a user known only through the identity provider: an account without a password. */
export async function addOidcUser(app: TestApp, { id, email, role = "user" }: { id: string; email: string; role?: "admin" | "user" }) {
  await app.exec(`insert into "user" (id, name, email, role) values ('${id}', '${id}', '${email}', '${role}')`);
  await app.exec(`insert into account (id, account_id, provider_id, user_id) values ('acc-${id}', 'sub-${id}', 'oidc', '${id}')`);
}

/** Send JSON with any method; state-changing requests always carry a JSON body, even an empty one. */
export function send(app: TestApp, method: string, path: string, body: unknown = {}) {
  return app.request(path, method === "GET" ? {} : { method, body: JSON.stringify(body) });
}
