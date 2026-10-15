import { type TestApp, testApp } from "#harness";
import { describe, expect, it } from "vitest";

import { addOidcUser, addUser, post, send, signIn } from "./users";

const ADA = "ada@example.invalid";
const BOB = "bob@example.invalid";

type AdminUser = {
  id: string;
  email: string;
  origin: string;
  role: string;
  roleSource: string;
  roleOverride: string | null;
  disabled: boolean;
  mustChangePassword: boolean;
  groups: { name: string; source: string }[];
  lastSignInAt: string | null;
};

/** Return an app where Ada, a local admin, is signed in. */
async function adminApp(): Promise<TestApp> {
  const app = await testApp();
  await addUser(app, { id: "ada", email: ADA, role: "admin" });
  expect((await signIn(app, ADA)).status).toBe(200);
  return app;
}

async function users(app: TestApp): Promise<AdminUser[]> {
  return ((await (await app.request("/api/admin/users")).json()) as { users: AdminUser[] }).users;
}

const userOf = async (app: TestApp, id: string) => (await users(app)).find((u) => u.id === id)!;
const codeOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

/** Make Ada an OIDC admin, keeping her session, so that Bob can be the last local admin. */
async function adaBecomesOidc(app: TestApp) {
  await app.exec(`update account set provider_id = 'oidc', password = null where user_id = 'ada'`);
}

describe("admin users", () => {
  it("is refused without a session and to non-admins", async () => {
    const app = await testApp();
    const routes: [string, string][] = [
      ["GET", "/api/admin/users"],
      ["POST", "/api/admin/users"],
      ["PATCH", "/api/admin/users/bob"],
      ["POST", "/api/admin/users/bob/password"],
      ["DELETE", "/api/admin/users/bob"],
    ];
    for (const [method, path] of routes) expect((await send(app, method, path)).status).toBe(401);
    await addUser(app, { id: "bob", email: BOB });
    await signIn(app, BOB);
    for (const [method, path] of routes) expect((await send(app, method, path)).status).toBe(403);
  });

  it("creates a local account whose temporary password must be changed at first sign-in", async () => {
    const app = await adminApp();
    const res = await post(app, "/api/admin/users", { name: "Bob", email: ` ${BOB.toUpperCase()} ` });
    expect(res.status).toBe(201);
    const { user, temporaryPassword } = (await res.json()) as { user: AdminUser; temporaryPassword: string };
    expect(user).toMatchObject({ email: BOB, origin: "local", role: "user", roleSource: "local", mustChangePassword: true, disabled: false });
    expect(temporaryPassword).toMatch(/^[A-Za-z2-9]{20}$/);

    const bob = app.another();
    expect((await signIn(bob, BOB, temporaryPassword)).status).toBe(200);
    expect(await codeOf(await bob.request("/api/admin/catalog"))).toBe("password_change_required");
    expect((await post(bob, "/api/account/password", { currentPassword: temporaryPassword, newPassword: "a brand new password" })).status).toBe(204);
    expect((await userOf(app, user.id)).mustChangePassword).toBe(false);
  });

  it("creates an admin when asked, and refuses invalid fields and taken e-mails, OIDC ones included", async () => {
    const app = await adminApp();
    const admin = await post(app, "/api/admin/users", { name: "Bob", email: BOB, role: "admin" });
    expect(((await admin.json()) as { user: AdminUser }).user.role).toBe("admin");
    await addOidcUser(app, { id: "carol", email: "carol@example.invalid" });

    const invalid = await post(app, "/api/admin/users", { name: " ", email: "nope", role: "owner" });
    expect(invalid.status).toBe(422);
    expect(((await invalid.json()) as { error: { fields: object } }).error.fields).toEqual({ name: "invalid_name", email: "invalid_email", role: "invalid_role" });
    for (const email of [BOB, "Carol@example.invalid"]) {
      const taken = await post(app, "/api/admin/users", { name: "Again", email });
      expect(((await taken.json()) as { error: { fields: object } }).error.fields).toEqual({ email: "email_taken" });
    }
  });

  it("lists origin, role source, groups and last sign-in", async () => {
    const app = await adminApp();
    await addOidcUser(app, { id: "carol", email: "carol@example.invalid", role: "admin" });
    await app.exec(`insert into "group" (id, name, source) values ('g1', 'Contractors', 'local')`);
    await app.exec(`insert into user_group (user_id, group_id) values ('carol', 'g1')`);
    const list = await users(app);
    expect(list.map((u) => u.id)).toEqual(["ada", "carol"]);
    expect(list[0]).toMatchObject({ origin: "local", role: "admin", roleSource: "local", groups: [] });
    expect(list[0]!.lastSignInAt).not.toBeNull();
    expect(list[1]).toMatchObject({ origin: "oidc", roleSource: "provider", roleOverride: null, groups: [{ name: "Contractors", source: "local" }], lastSignInAt: null });
  });

  it("forces or releases the role of an OIDC account, and keeps `role` for local accounts", async () => {
    const app = await adminApp();
    await addOidcUser(app, { id: "carol", email: "carol@example.invalid" });
    const forced = await send(app, "PATCH", "/api/admin/users/carol", { roleOverride: "admin" });
    expect(((await forced.json()) as { user: AdminUser }).user).toMatchObject({ role: "admin", roleSource: "override", roleOverride: "admin" });
    const released = await send(app, "PATCH", "/api/admin/users/carol", { roleOverride: null });
    expect(((await released.json()) as { user: AdminUser }).user).toMatchObject({ roleSource: "provider", roleOverride: null });

    expect((await send(app, "PATCH", "/api/admin/users/carol", { role: "admin" })).status).toBe(422);
    await addUser(app, { id: "bob", email: BOB });
    expect((await send(app, "PATCH", "/api/admin/users/bob", { roleOverride: "admin" })).status).toBe(422);
    expect(((await (await send(app, "PATCH", "/api/admin/users/bob", { role: "admin", name: " Robert " })).json()) as { user: AdminUser }).user).toMatchObject({
      role: "admin",
    });
    expect(await app.query(`select name from "user" where id = 'bob'`)).toEqual([{ name: "Robert" }]);
  });

  it("refuses to change one's own role, disable or delete oneself", async () => {
    const app = await adminApp();
    await addUser(app, { id: "bob", email: BOB, role: "admin" });
    for (const [method, body] of [
      ["PATCH", { role: "user" }],
      ["PATCH", { disabled: true }],
      ["DELETE", {}],
    ] as const) {
      const res = await send(app, method, "/api/admin/users/ada", body);
      expect(res.status).toBe(409);
      expect(await codeOf(res)).toBe("cannot_change_self");
    }
    expect((await send(app, "PATCH", "/api/admin/users/ada", { name: "Ada L." })).status).toBe(200);
  });

  it("keeps the last enabled local admin, whatever the change", async () => {
    const app = await adminApp();
    await addUser(app, { id: "bob", email: BOB, role: "admin" });
    await adaBecomesOidc(app);
    for (const [method, body] of [
      ["PATCH", { role: "user" }],
      ["PATCH", { disabled: true }],
      ["DELETE", {}],
    ] as const) {
      const res = await send(app, method, "/api/admin/users/bob", body);
      expect(res.status).toBe(409);
      expect(await codeOf(res)).toBe("last_local_admin");
    }
    expect(await userOf(app, "bob")).toMatchObject({ role: "admin", disabled: false });

    await addUser(app, { id: "dan", email: "dan@example.invalid", role: "admin" });
    expect((await send(app, "PATCH", "/api/admin/users/bob", { role: "user" })).status).toBe(200);
  });

  it("does not count a disabled local admin as the one that stays", async () => {
    const app = await adminApp();
    await addUser(app, { id: "bob", email: BOB, role: "admin" });
    await addUser(app, { id: "dan", email: "dan@example.invalid", role: "admin" });
    await adaBecomesOidc(app);
    expect((await send(app, "PATCH", "/api/admin/users/dan", { disabled: true })).status).toBe(200);
    expect(await codeOf(await send(app, "DELETE", "/api/admin/users/bob"))).toBe("last_local_admin");
  });

  it("disables an account: sessions closed, sign-in refused with 403 only for the right password", async () => {
    const app = await adminApp();
    await addUser(app, { id: "bob", email: BOB });
    const bob = app.another();
    expect((await signIn(bob, BOB)).status).toBe(200);

    const lastSignIn = (await userOf(app, "bob")).lastSignInAt;
    expect(((await (await send(app, "PATCH", "/api/admin/users/bob", { disabled: true })).json()) as { user: AdminUser }).user.disabled).toBe(true);
    expect(await (await bob.request("/api/auth/get-session")).json()).toBeNull();

    const right = await signIn(bob, BOB);
    expect(right.status).toBe(403);
    expect(await codeOf(right)).toBe("account_disabled");
    expect(right.headers.getSetCookie()).toEqual([]);
    expect(await app.query(`select count(*) as n from session where user_id = 'bob'`)).toEqual([{ n: 0 }]);
    expect((await signIn(bob, BOB, "a wrong password indeed")).status).toBe(401);
    expect((await userOf(app, "bob")).lastSignInAt).toBe(lastSignIn);

    await send(app, "PATCH", "/api/admin/users/bob", { disabled: false });
    expect((await signIn(bob, BOB)).status).toBe(200);
  });

  it("resets a local password: new temporary password, sessions closed", async () => {
    const app = await adminApp();
    await addUser(app, { id: "bob", email: BOB });
    const bob = app.another();
    await signIn(bob, BOB);
    const res = await post(app, "/api/admin/users/bob/password", {});
    const { temporaryPassword } = (await res.json()) as { temporaryPassword: string };
    expect(await (await bob.request("/api/auth/get-session")).json()).toBeNull();
    expect((await signIn(bob, BOB)).status).toBe(401);
    expect((await signIn(bob, BOB, temporaryPassword)).status).toBe(200);
    expect((await userOf(app, "bob")).mustChangePassword).toBe(true);

    await addOidcUser(app, { id: "carol", email: "carol@example.invalid" });
    expect(await codeOf(await post(app, "/api/admin/users/carol/password", {}))).toBe("no_local_password");
  });

  it("deletes a user with their sessions, accounts and memberships", async () => {
    const app = await adminApp();
    await addUser(app, { id: "bob", email: BOB });
    await app.exec(`insert into "group" (id, name, source) values ('g1', 'Contractors', 'local')`);
    await app.exec(`insert into user_group (user_id, group_id) values ('bob', 'g1')`);
    await signIn(app.another(), BOB);
    expect((await send(app, "DELETE", "/api/admin/users/bob")).status).toBe(204);
    for (const table of ["session", "account", "user_group"]) {
      expect(await app.query(`select count(*) as n from ${table} where user_id = 'bob'`)).toEqual([{ n: 0 }]);
    }
    expect((await send(app, "DELETE", "/api/admin/users/bob")).status).toBe(404);
  });
});
