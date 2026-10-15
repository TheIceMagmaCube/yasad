import { testApp } from "#harness";
import { describe, expect, it } from "vitest";

import { addUser, PASSWORD, post, signIn } from "./users";

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
