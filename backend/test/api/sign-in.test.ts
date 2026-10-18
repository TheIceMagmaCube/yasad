import { TEST_IP, testApp } from "#harness";
import { describe, expect, it } from "vitest";

import { addUser, PASSWORD, post, signIn } from "./users";

const code = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

describe("Better Auth routes", () => {
  it("only exposes session, sign-in and sign-out", async () => {
    const app = await testApp();
    expect((await app.request("/api/auth/get-session")).status).toBe(200);
    for (const path of ["/api/auth/sign-up/email", "/api/auth/change-password", "/api/auth/update-user", "/api/auth/list-sessions"]) {
      expect((await post(app, path, {})).status, path).toBe(404);
    }
  });
});

describe("session lifetime", () => {
  it("keeps the expiry set at sign-in even when the session is used days later", async () => {
    const app = await testApp({ SESSION_MAX_AGE: String(7 * 86400) });
    await addUser(app, { id: "ada", email: "ada@example.invalid" });
    expect((await signIn(app, "ada@example.invalid")).status).toBe(200);
    // Two days have passed since the sign-in: Better Auth would push a sliding session's expiry back to 7 days.
    await app.exec(`update session set expires_at = expires_at - ${2 * 86400 * 1000}, updated_at = updated_at - ${2 * 86400 * 1000}`);
    const [before] = await app.query("select expires_at from session");
    expect((await app.request("/api/auth/get-session")).status).toBe(200);
    expect(await app.query("select expires_at from session")).toEqual([before]);
  });
});

describe("sign-in limits", () => {
  it("blocks an e-mail after 5 failures from an IP, even with the right password", async () => {
    const app = await testApp();
    await addUser(app, { id: "u1", email: "bob@example.invalid" });
    for (let i = 0; i < 5; i++) expect((await signIn(app, "bob@example.invalid", "wrong password!")).status).toBe(401);

    const blocked = await signIn(app, " BOB@example.invalid ");
    expect(blocked.status).toBe(429);
    expect(await code(blocked)).toBe("rate_limited");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await signIn(app, "bob@example.invalid", PASSWORD, "198.51.100.7")).status).toBe(200);
  });

  it("lets no more than 5 guesses through in a parallel burst", async () => {
    const app = await testApp();
    await addUser(app, { id: "u1", email: "bob@example.invalid" });
    const statuses = await Promise.all(Array.from({ length: 20 }, () => signIn(app, "bob@example.invalid", "wrong password!").then((r) => r.status)));
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(15);
  });

  it("blocks an IP after 30 failures across e-mails", async () => {
    const app = await testApp();
    await addUser(app, { id: "u1", email: "bob@example.invalid" });
    // 29 failures already counted for this IP (30 real sign-ins would hash 30 passwords, too slow on workerd).
    await app.exec(`insert into rate_limit (key, count, window_start) values ('signin:${TEST_IP}', 29, ${Date.now()})`);
    expect((await signIn(app, "nobody@example.invalid", "wrong password!")).status).toBe(401);
    expect((await signIn(app, "bob@example.invalid")).status).toBe(429);
    expect((await signIn(app, "bob@example.invalid", PASSWORD, "198.51.100.7")).status).toBe(200);
  });

  it("resets the e-mail counter after a success", async () => {
    const app = await testApp();
    await addUser(app, { id: "u1", email: "bob@example.invalid" });
    for (let i = 0; i < 4; i++) await signIn(app, "bob@example.invalid", "wrong password!");
    expect((await signIn(app, "bob@example.invalid")).status).toBe(200);
    for (let i = 0; i < 4; i++) await signIn(app, "bob@example.invalid", "wrong password!");
    expect((await signIn(app, "bob@example.invalid")).status).toBe(200);
  });

  it("purges counters whose window ended more than a day ago", async () => {
    const app = await testApp();
    await app.exec(`insert into rate_limit (key, count, window_start) values ('signin:old', 3, ${Date.now() - 2 * 24 * 60 * 60 * 1000})`);
    await signIn(app, "nobody@example.invalid", "wrong password!");
    expect(await app.query("select key from rate_limit where key = 'signin:old'")).toEqual([]);
  });
});

describe("PASSWORD_SIGN_IN=false", () => {
  async function app() {
    const a = await testApp({ PASSWORD_SIGN_IN: "false" });
    await addUser(a, { id: "admin", email: "ada@example.invalid", role: "admin" });
    await addUser(a, { id: "user", email: "bob@example.invalid" });
    return a;
  }

  it("still lets a local admin sign in", async () => {
    expect((await signIn(await app(), "ada@example.invalid")).status).toBe(200);
  });

  it("answers a user, an unknown e-mail and a wrong admin password the same way", async () => {
    const a = await app();
    const answers = await Promise.all(
      [signIn(a, "bob@example.invalid"), signIn(a, "eve@example.invalid"), signIn(a, "ada@example.invalid", "wrong password!")].map(async (p) => {
        const res = await p;
        return { status: res.status, body: await res.json() };
      }),
    );
    expect(answers[0]!.status).toBe(401);
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
  });

  it("answers malformed requests the same way for an admin, a user and an unknown e-mail", async () => {
    const a = await app();
    const bodies = (email: string) => [
      { email, password: 123 },
      { email },
      { email, password: "x".repeat(200) },
      { email: ` ${email}`, password: PASSWORD },
      { email, password: PASSWORD, rememberMe: "yes" },
    ];
    for (const [i, adminBody] of bodies("ada@example.invalid").entries()) {
      const answers = await Promise.all(
        [adminBody, bodies("bob@example.invalid")[i], bodies("eve@example.invalid")[i]].map(async (body) => {
          const res = await post(a, "/api/auth/sign-in/email", body, `198.51.100.${10 + i}`);
          return { status: res.status, body: await res.json() };
        }),
      );
      expect(answers[1], JSON.stringify(adminBody)).toEqual(answers[0]);
      expect(answers[2], JSON.stringify(adminBody)).toEqual(answers[0]);
    }
  });

  it("counts malformed requests as failures", async () => {
    const a = await app();
    for (let i = 0; i < 5; i++) expect((await post(a, "/api/auth/sign-in/email", { email: "ada@example.invalid" })).status).toBe(400);
    expect((await signIn(a, "ada@example.invalid")).status).toBe(429);
  });

  it("counts refused users as failures", async () => {
    const a = await app();
    for (let i = 0; i < 5; i++) await signIn(a, "bob@example.invalid");
    expect((await signIn(a, "bob@example.invalid")).status).toBe(429);
  });
});
