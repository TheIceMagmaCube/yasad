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

describe("sign-in limits", () => {
  it("blocks an e-mail after 5 failures from an IP, even with the right password", async () => {
    const app = await testApp();
    await addUser(app, { id: "u1", email: "bob@example.org" });
    for (let i = 0; i < 5; i++) expect((await signIn(app, "bob@example.org", "wrong password!")).status).toBe(401);

    const blocked = await signIn(app, " BOB@example.org ");
    expect(blocked.status).toBe(429);
    expect(await code(blocked)).toBe("rate_limited");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await signIn(app, "bob@example.org", PASSWORD, "198.51.100.7")).status).toBe(200);
  });

  it("lets no more than 5 guesses through in a parallel burst", async () => {
    const app = await testApp();
    await addUser(app, { id: "u1", email: "bob@example.org" });
    const statuses = await Promise.all(Array.from({ length: 20 }, () => signIn(app, "bob@example.org", "wrong password!").then((r) => r.status)));
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(15);
  });

  it("blocks an IP after 30 failures across e-mails", async () => {
    const app = await testApp();
    await addUser(app, { id: "u1", email: "bob@example.org" });
    // 29 failures already counted for this IP (30 real sign-ins would hash 30 passwords, too slow on workerd).
    await app.exec(`insert into rate_limit (key, count, window_start) values ('signin:${TEST_IP}', 29, ${Date.now()})`);
    expect((await signIn(app, "nobody@example.org", "wrong password!")).status).toBe(401);
    expect((await signIn(app, "bob@example.org")).status).toBe(429);
    expect((await signIn(app, "bob@example.org", PASSWORD, "198.51.100.7")).status).toBe(200);
  });

  it("resets the e-mail counter after a success", async () => {
    const app = await testApp();
    await addUser(app, { id: "u1", email: "bob@example.org" });
    for (let i = 0; i < 4; i++) await signIn(app, "bob@example.org", "wrong password!");
    expect((await signIn(app, "bob@example.org")).status).toBe(200);
    for (let i = 0; i < 4; i++) await signIn(app, "bob@example.org", "wrong password!");
    expect((await signIn(app, "bob@example.org")).status).toBe(200);
  });

  it("purges counters whose window ended more than a day ago", async () => {
    const app = await testApp();
    await app.exec(`insert into rate_limit (key, count, window_start) values ('signin:old', 3, ${Date.now() - 2 * 24 * 60 * 60 * 1000})`);
    await signIn(app, "nobody@example.org", "wrong password!");
    expect(await app.query("select key from rate_limit where key = 'signin:old'")).toEqual([]);
  });
});

describe("PASSWORD_SIGN_IN=false", () => {
  async function app() {
    const a = await testApp({ PASSWORD_SIGN_IN: "false" });
    await addUser(a, { id: "admin", email: "ada@example.org", role: "admin" });
    await addUser(a, { id: "user", email: "bob@example.org" });
    return a;
  }

  it("still lets a local admin sign in", async () => {
    expect((await signIn(await app(), "ada@example.org")).status).toBe(200);
  });

  it("answers a user, an unknown e-mail and a wrong admin password the same way", async () => {
    const a = await app();
    const answers = await Promise.all(
      [signIn(a, "bob@example.org"), signIn(a, "eve@example.org"), signIn(a, "ada@example.org", "wrong password!")].map(async (p) => {
        const res = await p;
        return { status: res.status, body: await res.json() };
      }),
    );
    expect(answers[0]!.status).toBe(401);
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
  });

  it("counts refused users as failures", async () => {
    const a = await app();
    for (let i = 0; i < 5; i++) await signIn(a, "bob@example.org");
    expect((await signIn(a, "bob@example.org")).status).toBe(429);
  });
});
