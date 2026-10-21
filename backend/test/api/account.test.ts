import { testApp } from "#harness";
import { describe, expect, it } from "vitest";

import { addOidcUser, addUser, PASSWORD, post, sessionCookie, signIn } from "./users";

const NEW_PASSWORD = "a brand new passphrase";
type ErrorBody = { error: { code: string; fields?: Record<string, string> } };
const errorOf = async (res: Response) => ((await res.json()) as ErrorBody).error;
const changePassword = (app: Awaited<ReturnType<typeof testApp>>, currentPassword: string, newPassword: string) =>
  post(app, "/api/account/password", { currentPassword, newPassword });

/** Return an app with a signed-in user who still has a temporary password. */
async function flaggedUser() {
  const app = await testApp();
  await addUser(app, { id: "u1", email: "bob@example.invalid", mustChangePassword: true });
  expect((await signIn(app, "bob@example.invalid")).status).toBe(200);
  return app;
}

describe("temporary password", () => {
  it("refuses the API until the password is changed", async () => {
    const app = await flaggedUser();
    const res = await app.request("/api/setup");
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe("password_change_required");
  });

  it("keeps the session, instance, health and sign-out routes open", async () => {
    const app = await flaggedUser();
    const session = (await (await app.request("/api/auth/get-session")).json()) as { user: { mustChangePassword: boolean } };
    expect(session.user.mustChangePassword).toBe(true);
    expect((await app.request("/api/instance")).status).toBe(200);
    expect((await app.request("/api/health")).status).toBe(200);
    expect((await post(app, "/api/auth/sign-out", {})).status).toBe(200);
  });

  it("opens the API once changed, closing the other sessions but not this one", async () => {
    const app = await flaggedUser();
    await app.exec(
      `insert into session (id, expires_at, token, user_id, created_at, updated_at) values ('other', ${Date.now() + 3_600_000}, 'other-token', 'u1', 0, 0)`,
    );
    expect((await changePassword(app, PASSWORD, NEW_PASSWORD)).status).toBe(204);
    expect((await app.request("/api/setup")).status).toBe(200);
    expect(await app.query("select id from session where user_id = 'u1' and id = 'other'")).toEqual([]);
    expect(await app.query("select id from session where user_id = 'u1'")).toHaveLength(1);
    expect(await app.query("select must_change_password as flag from \"user\" where id = 'u1'")).toEqual([{ flag: 0 }]);

    expect((await post(app, "/api/auth/sign-out", {})).status).toBe(200);
    expect((await signIn(app, "bob@example.invalid", NEW_PASSWORD)).status).toBe(200);
  });
});

describe("POST /api/account/password", () => {
  it("needs a session", async () => {
    const res = await changePassword(await testApp(), PASSWORD, NEW_PASSWORD);
    expect(res.status).toBe(401);
  });

  it("refuses a wrong current password", async () => {
    const res = await changePassword(await flaggedUser(), "wrong password!", NEW_PASSWORD);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe("invalid_password");
  });

  it("refuses a short or unchanged new password", async () => {
    const app = await flaggedUser();
    expect((await errorOf(await changePassword(app, PASSWORD, "short"))).fields).toEqual({ newPassword: "invalid_password" });
    expect((await errorOf(await changePassword(app, PASSWORD, PASSWORD))).fields).toEqual({ newPassword: "password_unchanged" });
  });

  it("is limited to 5 wrong current passwords", async () => {
    const app = await flaggedUser();
    for (let i = 0; i < 5; i++) await changePassword(app, "wrong password!", NEW_PASSWORD);
    const res = await changePassword(app, PASSWORD, NEW_PASSWORD);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).not.toBeNull();
  });

  it("lets no more than 5 guesses through in a parallel burst", async () => {
    const app = await flaggedUser();
    const statuses = await Promise.all(Array.from({ length: 12 }, () => changePassword(app, "wrong password!", NEW_PASSWORD).then((r) => r.status)));
    expect(statuses.filter((s) => s === 403)).toHaveLength(5);
  });

  it("also works for a user without the flag", async () => {
    const app = await testApp();
    await addUser(app, { id: "u2", email: "carol@example.invalid" });
    await signIn(app, "carol@example.invalid");
    expect((await changePassword(app, PASSWORD, NEW_PASSWORD)).status).toBe(204);
  });
});

/** Return an app with a signed-in local user `u1` (bob@example.invalid). */
async function localUser() {
  const app = await testApp();
  await addUser(app, { id: "u1", email: "bob@example.invalid" });
  expect((await signIn(app, "bob@example.invalid")).status).toBe(200);
  return app;
}

const patchAccount = (app: Awaited<ReturnType<typeof testApp>>, body: unknown, init: RequestInit = {}) =>
  app.request("/api/account", { method: "PATCH", body: JSON.stringify(body), ...init });

type AccountBody = { origin: string; groups: { name: string; source: string }[]; providerGroupsAt: string | null };
const AUTHENTICATED = { name: "authenticated", source: "system" };
const EVERYONE = { name: "everyone", source: "system" };
const accountOf = async (app: Awaited<ReturnType<typeof testApp>>) => (await (await app.request("/api/account")).json()) as AccountBody;

describe("GET /api/account", () => {
  it("needs a session", async () => {
    const res = await (await testApp()).request("/api/account");
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe("unauthenticated");
  });

  it("says a password account is local and lists the built-in groups, never cached", async () => {
    const res = await (await localUser()).request("/api/account");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ origin: "local", groups: [AUTHENTICATED, EVERYONE], providerGroupsAt: null });
  });

  it("says an account with only another provider is oidc", async () => {
    const app = await testApp();
    await addOidcUser(app, { id: "olga", email: "olga@example.invalid" });
    const res = await app.request("/api/account", { headers: { cookie: await sessionCookie(app, "olga") } });
    expect(res.status).toBe(200);
    // Session written straight in the database: no sign-in date.
    expect(await res.json()).toEqual({ origin: "oidc", groups: [AUTHENTICATED, EVERYONE], providerGroupsAt: null });
  });

  it("lists a local group", async () => {
    const app = await localUser();
    await app.exec(`insert into "group" (id, name, source) values ('g1', 'Contractors', 'local')`);
    await app.exec(`insert into user_group (user_id, group_id) values ('u1', 'g1')`);
    expect(await accountOf(app)).toEqual({ origin: "local", groups: [{ name: "Contractors", source: "local" }, AUTHENTICATED, EVERYONE], providerGroupsAt: null });
  });

  it("lists a provider group and dates it by the last sign-in", async () => {
    const app = await testApp();
    await addOidcUser(app, { id: "olga", email: "olga@example.invalid" });
    await app.exec(`update "user" set last_sign_in_at = 1760000000000 where id = 'olga'`);
    await app.exec(`insert into "group" (id, name, source) values ('g1', 'Developers', 'oidc')`);
    await app.exec(`insert into user_group (user_id, group_id) values ('olga', 'g1')`);
    const res = await app.request("/api/account", { headers: { cookie: await sessionCookie(app, "olga") } });
    expect(await res.json()).toEqual({
      origin: "oidc",
      groups: [{ name: "Developers", source: "oidc" }, AUTHENTICATED, EVERYONE],
      providerGroupsAt: new Date(1760000000000).toISOString(),
    });
  });

  it("lists only the signed-in person's groups, whatever the query says", async () => {
    const app = await localUser();
    await addUser(app, { id: "u2", email: "carol@example.invalid" });
    await app.exec(`insert into "group" (id, name, source) values ('ga', 'A', 'local'), ('gb', 'B', 'local')`);
    await app.exec(`insert into user_group (user_id, group_id) values ('u1', 'ga'), ('u2', 'gb')`);
    const bodies = await Promise.all(["/api/account", "/api/account?userId=u2", "/api/account?id=u2"].map((path) => app.request(path).then((r) => r.text())));
    for (const body of bodies) expect(body).not.toContain('"B"');
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0]!)).toMatchObject({ groups: [{ name: "A", source: "local" }, AUTHENTICATED, EVERYONE] });
  });

  it("lists an administrator's own groups only", async () => {
    const app = await testApp();
    await addUser(app, { id: "ada", email: "ada@example.invalid", role: "admin" });
    await addUser(app, { id: "u2", email: "carol@example.invalid" });
    await app.exec(`insert into "group" (id, name, source) values ('ops', 'Ops', 'local'), ('gb', 'B', 'local')`);
    await app.exec(`insert into user_group (user_id, group_id) values ('ada', 'ops'), ('u2', 'gb')`);
    expect((await signIn(app, "ada@example.invalid")).status).toBe(200);
    expect((await accountOf(app)).groups).toEqual([{ name: "Ops", source: "local" }, AUTHENTICATED, EVERYONE]);
  });

  it("keeps groups of the same name apart by origin and case", async () => {
    const app = await localUser();
    await app.exec(`insert into "group" (id, name, source) values ('l-dev', 'Dev', 'local'), ('o-dev', 'Dev', 'oidc'), ('o-dev2', 'dev', 'oidc')`);
    await app.exec(`insert into user_group (user_id, group_id) values ('u1', 'l-dev'), ('u1', 'o-dev'), ('u1', 'o-dev2')`);
    const { groups } = await accountOf(app);
    expect(groups.filter((g) => g.source !== "system")).toEqual(
      expect.arrayContaining([
        { name: "Dev", source: "local" },
        { name: "Dev", source: "oidc" },
        { name: "dev", source: "oidc" },
      ]),
    );
    expect(groups).toHaveLength(5);
  });

  it("never lists a built-in group twice, even with a forged membership", async () => {
    const app = await localUser();
    await app.exec(`insert into user_group (user_id, group_id) select 'u1', id from "group" where source = 'system' and name = 'authenticated'`);
    expect((await accountOf(app)).groups).toEqual([AUTHENTICATED, EVERYONE]);
  });

  it("waits for a temporary password to be replaced", async () => {
    const res = await (await flaggedUser()).request("/api/account");
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe("password_change_required");
  });
});

describe("PATCH /api/account", () => {
  const profileOf = async (app: Awaited<ReturnType<typeof testApp>>) =>
    (await app.query(`select name, email from "user" where id = 'u1'`))[0];

  it("needs a session", async () => {
    expect((await patchAccount(await testApp(), { name: "Bob" })).status).toBe(401);
  });

  it("waits for a temporary password to be replaced", async () => {
    const res = await patchAccount(await flaggedUser(), { name: "Bob" });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe("password_change_required");
  });

  it("changes the name without a password, trimmed", async () => {
    const app = await localUser();
    const res = await patchAccount(app, { name: "  Robert Tables " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: { id: "u1", name: "Robert Tables", email: "bob@example.invalid" } });
    expect(await profileOf(app)).toEqual({ name: "Robert Tables", email: "bob@example.invalid" });
    const session = (await (await app.request("/api/auth/get-session")).json()) as { user: { name: string } };
    expect(session.user.name).toBe("Robert Tables");
  });

  it("refuses an empty or too long name", async () => {
    const app = await localUser();
    expect((await errorOf(await patchAccount(app, { name: " " }))).fields).toEqual({ name: "invalid_name" });
    expect((await errorOf(await patchAccount(app, { name: "x".repeat(101) }))).fields).toEqual({ name: "invalid_name" });
    expect((await errorOf(await patchAccount(app, { name: 3 }))).fields).toEqual({ name: "invalid_name" });
  });

  it("changes the e-mail with the current password, then signs in with it", async () => {
    const app = await localUser();
    const res = await patchAccount(app, { email: " Robert@Example.invalid ", currentPassword: PASSWORD });
    expect(res.status).toBe(200);
    expect(await profileOf(app)).toEqual({ name: "u1", email: "robert@example.invalid" });
    expect((await post(app, "/api/auth/sign-out", {})).status).toBe(200);
    expect((await signIn(app, "robert@example.invalid")).status).toBe(200);
  });

  it("asks for the current password before changing the e-mail", async () => {
    const app = await localUser();
    const missing = await patchAccount(app, { email: "robert@example.invalid" });
    expect(missing.status).toBe(422);
    expect((await errorOf(missing)).fields).toEqual({ currentPassword: "required" });
    const wrong = await patchAccount(app, { email: "robert@example.invalid", currentPassword: "wrong password!" });
    expect(wrong.status).toBe(403);
    expect((await errorOf(wrong)).code).toBe("invalid_password");
    expect(await profileOf(app)).toEqual({ name: "u1", email: "bob@example.invalid" });
  });

  it("needs no password when the e-mail stays the same, whatever its case", async () => {
    const app = await localUser();
    expect((await patchAccount(app, { name: "Bob", email: "BOB@example.invalid" })).status).toBe(200);
  });

  it("refuses an invalid e-mail, and one another account uses", async () => {
    const app = await localUser();
    await addUser(app, { id: "u2", email: "carol@example.invalid" });
    expect((await errorOf(await patchAccount(app, { email: "not-an-email", currentPassword: PASSWORD }))).fields).toEqual({ email: "invalid_email" });
    const taken = await patchAccount(app, { email: "Carol@example.invalid", currentPassword: PASSWORD });
    expect(taken.status).toBe(422);
    expect((await errorOf(taken)).fields).toEqual({ email: "email_taken" });
    expect(await profileOf(app)).toEqual({ name: "u1", email: "bob@example.invalid" });
  });

  it("checks the password before saying an address is taken", async () => {
    const app = await localUser();
    await addUser(app, { id: "u2", email: "carol@example.invalid" });
    const res = await patchAccount(app, { email: "carol@example.invalid", currentPassword: "wrong password!" });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe("invalid_password");
  });

  it("counts wrong passwords with the password change: 5 at most", async () => {
    const app = await localUser();
    for (let i = 0; i < 3; i++) await changePassword(app, "wrong password!", NEW_PASSWORD);
    for (let i = 0; i < 2; i++) await patchAccount(app, { email: "robert@example.invalid", currentPassword: "wrong password!" });
    const res = await patchAccount(app, { email: "robert@example.invalid", currentPassword: PASSWORD });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).not.toBeNull();
  });

  it("counts a taken address as an attempt, so the password cannot list the accounts", async () => {
    const app = await localUser();
    await addUser(app, { id: "u2", email: "carol@example.invalid" });
    for (let i = 0; i < 5; i++) {
      const res = await patchAccount(app, { email: "carol@example.invalid", currentPassword: PASSWORD });
      expect((await errorOf(res)).fields).toEqual({ email: "email_taken" });
    }
    const res = await patchAccount(app, { email: "carol@example.invalid", currentPassword: PASSWORD });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).not.toBeNull();
  });

  it("releases the attempt once the e-mail is saved", async () => {
    const app = await localUser();
    for (let i = 0; i < 6; i++) {
      const email = i % 2 === 0 ? "robert@example.invalid" : "bob@example.invalid";
      expect((await patchAccount(app, { email, currentPassword: PASSWORD })).status).toBe(200);
    }
  });

  it("leaves the profile of an identity provider account alone", async () => {
    const app = await testApp();
    await addOidcUser(app, { id: "olga", email: "olga@example.invalid" });
    const res = await patchAccount(app, { name: "Olga" }, { headers: { cookie: await sessionCookie(app, "olga") } });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe("profile_from_provider");
    expect(await app.query(`select name from "user" where id = 'olga'`)).toEqual([{ name: "olga" }]);
  });

  it("comes from the app's origin only", async () => {
    const app = await localUser();
    const res = await patchAccount(app, { name: "Mallory" }, { headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    expect(await profileOf(app)).toEqual({ name: "u1", email: "bob@example.invalid" });
  });
});
