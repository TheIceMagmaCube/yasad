import { type TestApp, testApp } from "#harness";
import { describe, expect, it } from "vitest";

const CODE = "setup-code-for-the-tests-0123456789";
const ADMIN = {
  name: "Ada Lovelace",
  email: "Ada@Example.org",
  password: "correct horse battery",
  passwordConfirm: "correct horse battery",
};

const post = (app: TestApp, path: string, body: unknown, headers?: HeadersInit) =>
  app.request(path, { method: "POST", body: JSON.stringify(body), headers });
type Body = {
  open?: boolean;
  error: { code: string; attemptsLeft?: number; fields: Record<string, string> };
  user: { name: string; email: string; role: string };
};
const json = async (res: Response) => (await res.json()) as Body;
const setupState = async (app: TestApp) => json(await app.request("/api/setup"));
const session = async (app: TestApp) => json(await app.request("/api/auth/get-session"));

describe("setup availability", () => {
  it("is closed without SETUP_CODE, even on an empty database", async () => {
    const app = await testApp();
    expect(await setupState(app)).toEqual({ open: false });
    const res = await post(app, "/api/setup/verify-code", { code: CODE });
    expect(res.status).toBe(404);
    expect((await json(res)).error.code).toBe("setup_closed");
    expect((await post(app, "/api/setup", { code: CODE, ...ADMIN })).status).toBe(404);
  });

  it("is open with SETUP_CODE and no admin", async () => {
    expect(await setupState(await testApp({ SETUP_CODE: CODE }))).toEqual({ open: true });
  });

  it("stays open when the only admin signs in with OIDC", async () => {
    const app = await testApp({ SETUP_CODE: CODE });
    await app.exec(`insert into "user" (id, name, email, role) values ('o1', 'Okta Admin', 'okta@example.org', 'admin')`);
    await app.exec(`insert into account (id, account_id, provider_id, user_id) values ('a1', 'sub-1', 'oidc', 'o1')`);
    expect(await setupState(app)).toEqual({ open: true });
    expect((await post(app, "/api/setup", { code: CODE, ...ADMIN })).status).toBe(201);
  });
});

describe("setup code", () => {
  it("accepts the right code without storing anything", async () => {
    const app = await testApp({ SETUP_CODE: CODE });
    expect((await post(app, "/api/setup/verify-code", { code: CODE })).status).toBe(204);
    expect(await setupState(app)).toEqual({ open: true });
  });

  it("refuses a wrong or missing code and counts down", async () => {
    const app = await testApp({ SETUP_CODE: CODE });
    const first = await post(app, "/api/setup/verify-code", { code: "nope" });
    expect(first.status).toBe(403);
    expect((await json(first)).error).toMatchObject({ code: "invalid_code", attemptsLeft: 4 });
    const second = await post(app, "/api/setup/verify-code", {});
    expect((await json(second)).error).toMatchObject({ code: "invalid_code", attemptsLeft: 3 });
  });

  it("blocks after 5 wrong codes, even the right one, with Retry-After", async () => {
    const app = await testApp({ SETUP_CODE: CODE });
    for (let i = 0; i < 5; i++) await post(app, "/api/setup/verify-code", { code: "nope" });
    const res = await post(app, "/api/setup/verify-code", { code: CODE });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("shares one counter between both steps and does not count right codes", async () => {
    const app = await testApp({ SETUP_CODE: CODE });
    await post(app, "/api/setup/verify-code", { code: CODE });
    for (let i = 0; i < 3; i++) await post(app, "/api/setup/verify-code", { code: "nope" });
    const last = await post(app, "/api/setup", { code: "nope", ...ADMIN });
    expect((await json(last)).error).toMatchObject({ code: "invalid_code", attemptsLeft: 1 });
  });

  it("counts per client IP", async () => {
    const app = await testApp({ SETUP_CODE: CODE });
    for (let i = 0; i < 5; i++) await post(app, "/api/setup/verify-code", { code: "nope" });
    const other = await post(app, "/api/setup/verify-code", { code: CODE }, { "cf-connecting-ip": "198.51.100.7" });
    expect(other.status).toBe(204);
  });
});

describe("POST /api/setup", () => {
  it("creates a local admin and signs them in", async () => {
    const app = await testApp({ SETUP_CODE: CODE });
    const res = await post(app, "/api/setup", { code: CODE, ...ADMIN });
    expect(res.status).toBe(201);
    expect(await json(res)).toEqual({ user: { name: "Ada Lovelace", email: "ada@example.org" } });
    const { user } = await session(app);
    expect(user).toMatchObject({ name: "Ada Lovelace", email: "ada@example.org", role: "admin" });
  });

  it("closes setup for good once done", async () => {
    const app = await testApp({ SETUP_CODE: CODE });
    await post(app, "/api/setup", { code: CODE, ...ADMIN });
    expect(await setupState(app)).toEqual({ open: false, setupCodeStillSet: true });
    const again = await post(app, "/api/setup", { code: CODE, ...ADMIN, email: "eve@example.org" });
    expect(again.status).toBe(404);
  });

  it("rejects invalid fields and writes nothing", async () => {
    const app = await testApp({ SETUP_CODE: CODE });
    const res = await post(app, "/api/setup", {
      code: CODE,
      name: " ",
      email: "not-an-email",
      password: "short",
      passwordConfirm: "other",
    });
    expect(res.status).toBe(422);
    expect(Object.keys((await json(res)).error.fields).sort()).toEqual(["email", "name", "password", "passwordConfirm"]);
    expect(await setupState(app)).toEqual({ open: true });
  });

  it("rejects an e-mail already used by another account", async () => {
    const app = await testApp({ SETUP_CODE: CODE });
    await app.exec(`insert into "user" (id, name, email) values ('o1', 'Ada', 'ada@example.org')`);
    const res = await post(app, "/api/setup", { code: CODE, ...ADMIN });
    expect(res.status).toBe(422);
    expect((await json(res)).error.fields).toHaveProperty("email");
  });

  it("recovers from a stale setup marker left without a local admin", async () => {
    const app = await testApp({ SETUP_CODE: CODE });
    await app.exec(`insert into setting (key, value) values ('setup.completed', 'stale')`);
    expect((await post(app, "/api/setup", { code: CODE, ...ADMIN })).status).toBe(201);
  });

  it("reports a failed write as a server error, not as a closed setup", async () => {
    const app = await testApp({ SETUP_CODE: CODE });
    await app.exec(`create trigger fail_user before insert on "user" begin select raise(abort, 'write failed'); end`);
    try {
      const res = await post(app, "/api/setup", { code: CODE, ...ADMIN });
      expect(res.status).toBe(500);
      expect((await json(res)).error.code).toBe("internal_error");
      expect(await setupState(app)).toEqual({ open: true });
    } finally {
      await app.exec("drop trigger fail_user");
    }
  });

  it("lets exactly one of two concurrent setups win", async () => {
    const app = await testApp({ SETUP_CODE: CODE });
    const results = await Promise.all([
      post(app, "/api/setup", { code: CODE, ...ADMIN }),
      post(app, "/api/setup", { code: CODE, ...ADMIN, email: "eve@example.org" }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(201);
    expect([404, 409]).toContain(statuses[1]);
  });
});

describe("authentication", () => {
  it("refuses public sign-up", async () => {
    const app = await testApp({ SETUP_CODE: CODE });
    const res = await post(app, "/api/auth/sign-up/email", { name: "Eve", email: "eve@example.org", password: "password-of-eve" });
    expect(res.status).toBe(400);
    expect(await setupState(app)).toEqual({ open: true });
  });

  it("signs out and back in with the admin account", async () => {
    const app = await testApp({ SETUP_CODE: CODE });
    await post(app, "/api/setup", { code: CODE, ...ADMIN });
    expect((await post(app, "/api/auth/sign-out", {})).status).toBe(200);
    expect(await session(app)).toBeNull();

    const wrong = await post(app, "/api/auth/sign-in/email", { email: "ada@example.org", password: "wrong password!" });
    expect(wrong.status).toBe(401);
    const right = await post(app, "/api/auth/sign-in/email", { email: "ada@example.org", password: ADMIN.password });
    expect(right.status).toBe(200);
    expect((await session(app)).user.role).toBe("admin");
  });

  it("never lets the client change its role", async () => {
    const app = await testApp({ SETUP_CODE: CODE });
    await post(app, "/api/setup", { code: CODE, ...ADMIN });
    await post(app, "/api/auth/update-user", { name: "Ada", role: "user" });
    expect((await session(app)).user.role).toBe("admin");
  });

  it("refuses request bodies over 16 KB", async () => {
    const app = await testApp({ SETUP_CODE: CODE });
    const res = await post(app, "/api/setup", { code: CODE, ...ADMIN, name: "x".repeat(20_000) });
    expect(res.status).toBe(413);
    expect((await json(res)).error.code).toBe("payload_too_large");
  });

  it("answers 500 on an invalid configuration", async () => {
    const res = await (await testApp({ AUTH_SECRET: "short" })).request("/api/health");
    expect(res.status).toBe(500);
    expect((await json(res)).error.code).toBe("invalid_config");
  });
});
