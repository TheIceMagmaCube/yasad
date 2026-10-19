import { TEST_IP, type TestApp, testApp, type TestEnv } from "#harness";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type FakeClaims, fakeOidc, s256 } from "../harness/fake-oidc";
import { addOidcUser, addUser, post, signIn } from "./users";

const provider = fakeOidc();
const other = fakeOidc({ issuer: "https://other-idp.test" });
const providers = [provider, other];

/** Send YASAD's outgoing requests to the fake providers, after `rewrite` when given. */
function routeFetch(rewrite: (request: Request) => Promise<Request> = async (request) => request) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = await rewrite(new Request(input, init));
    const target = providers.find((p) => new URL(request.url).origin === new URL(p.issuer).origin);
    if (!target) throw new TypeError(`Unexpected request to ${request.url}`);
    return target.handle(request);
  });
}

beforeEach(() => {
  for (const p of providers) {
    p.faults = {};
    p.requests = [];
  }
  routeFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const alice: FakeClaims = { sub: "alice", email: "alice@example.invalid", email_verified: true, name: "Alice", groups: ["staff"] };

function oidcApp(env: TestEnv = {}, idp = provider): Promise<TestApp> {
  return testApp({ ...idp.env, ...env });
}

/** Start a provider sign-in as the sign-in page does. */
const start = (app: TestApp, body: unknown = {}) => post(app, "/api/auth/sign-in/social", body);

/** Return the address the provider sends the browser back to, after authenticating `claims`. */
async function authorize(app: TestApp, claims: FakeClaims, body: unknown = {}, idp = provider): Promise<string> {
  const res = await start(app, body);
  expect(res.status).toBe(200);
  const { url } = (await res.json()) as { url: string };
  const answer = await idp.handle(new Request(idp.as(url, claims)));
  return answer.headers.get("location")!;
}

/** Sign in through the provider and return the callback's answer. */
async function providerSignIn(app: TestApp, claims: FakeClaims, body: unknown = {}, idp = provider): Promise<Response> {
  return app.request(await authorize(app, claims, body, idp));
}

/** Return the sign-in error code of a callback answer, or null when it went elsewhere. */
function errorOf(res: Response): string | null {
  expect(res.status).toBe(302);
  const target = new URL(res.headers.get("location")!);
  return target.pathname === "/sign-in" ? target.searchParams.get("error") : null;
}

async function sessionUser(app: TestApp): Promise<Record<string, unknown> | null> {
  const body = (await (await app.request("/api/auth/get-session")).json()) as { user?: Record<string, unknown> } | null;
  return body?.user ?? null;
}

const oidcGroupsOf = async (app: TestApp, userId: string) =>
  (
    await app.query(
      `select g.name from user_group ug join "group" g on g.id = ug.group_id where ug.user_id = '${userId}' and g.source = 'oidc' order by g.name`,
    )
  ).map((r) => r.name);

async function userByEmail(app: TestApp, email: string) {
  const [row] = await app.query(`select id, name, email, role, role_override from "user" where email = '${email}'`);
  return row;
}

describe("OIDC configuration", () => {
  it("hides the routes and the button when OIDC is not configured", async () => {
    const app = await testApp();
    expect((await start(app)).status).toBe(404);
    expect((await app.request("/api/auth/callback/oidc?code=x&state=y")).status).toBe(404);
    expect(await (await app.request("/api/instance")).json()).toMatchObject({ oidc: null });
  });

  it("shows the provider name", async () => {
    const app = await oidcApp({ OIDC_PROVIDER_NAME: "Okta" });
    expect(await (await app.request("/api/instance")).json()).toMatchObject({ oidc: { name: "Okta" } });
    expect(await (await (await oidcApp()).request("/api/instance")).json()).toMatchObject({ oidc: { name: "SSO" } });
  });

  it("refuses a partial configuration", async () => {
    const app = await testApp({ OIDC_CLIENT_ID: "yasad" });
    const res = await app.request("/api/instance");
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_config" } });
  });

  it("answers 404 for any other provider id", async () => {
    const app = await oidcApp();
    expect((await app.request("/api/auth/callback/google?code=x&state=y")).status).toBe(404);
  });
});

describe("provider sign-in", () => {
  it("creates the account, writes its groups and role, and opens a session", async () => {
    const app = await oidcApp({ OIDC_ADMIN_GROUPS: "admins" });
    const res = await providerSignIn(app, { ...alice, groups: ["staff", "admins"] });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://yasad.test/");

    const row = await userByEmail(app, "alice@example.invalid");
    expect(row).toMatchObject({ name: "Alice", role: "admin", role_override: null });
    expect(await app.query(`select account_id, provider_id from account where user_id = '${row!.id}'`)).toEqual([
      { account_id: "https://idp.test|alice", provider_id: "oidc" },
    ]);
    expect(await oidcGroupsOf(app, row!.id as string)).toEqual(["admins", "staff"]);
    expect(await sessionUser(app)).toMatchObject({ email: "alice@example.invalid", role: "admin" });
    const [signedIn] = await app.query(`select last_sign_in_at from "user" where id = '${row!.id}'`);
    expect(signedIn!.last_sign_in_at).not.toBeNull();
  });

  it("goes back to a same-origin returnTo, and to / for anything else", async () => {
    const app = await oidcApp();
    expect((await providerSignIn(app, alice, { returnTo: "/admin/groups?tab=1" })).headers.get("location")).toBe(
      "https://yasad.test/admin/groups?tab=1",
    );
    for (const returnTo of ["https://evil.example/", "//evil.example/", "/\\evil.example", "/\t/evil.example", "javascript:alert(1)", "/sign-in?error=x", 42]) {
      const res = await providerSignIn(app.another(), alice, { returnTo });
      expect(res.headers.get("location"), String(returnTo)).toBe("https://yasad.test/");
    }
  });

  it("asks for the code with PKCE S256 and a nonce, and takes the person from the token, never from userinfo", async () => {
    const app = await oidcApp({ OIDC_SCOPES: "openid email profile groups" });
    const { url } = (await (await start(app)).json()) as { url: string };
    const params = new URL(url).searchParams;
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toBeTruthy();
    expect(params.get("nonce")).toBeTruthy();
    expect(params.get("redirect_uri")).toBe("https://yasad.test/api/auth/callback/oidc");
    expect(params.get("scope")).toBe("openid email profile groups");
    expect(params.get("response_mode")).toBe("query");

    const answer = await provider.handle(new Request(provider.as(url, alice)));
    expect((await app.request(answer.headers.get("location")!)).headers.get("location")).toBe("https://yasad.test/");
    // The fake's userinfo answers another e-mail, name and groups.
    const row = await userByEmail(app, "alice@example.invalid");
    expect(row).toMatchObject({ name: "Alice" });
    expect(await oidcGroupsOf(app, row!.id as string)).toEqual(["staff"]);
    expect(await app.query(`select name from "group" where name = 'from-userinfo'`)).toEqual([]);
    expect(provider.requests.some((r) => new URL(r.url).pathname === "/userinfo")).toBe(false);
  });

  it("depends on the PKCE verifier it sends with the code", async () => {
    const app = await oidcApp();
    const location = await authorize(app, alice);
    // The provider refuses an exchange without the verifier of the challenge YASAD sent.
    routeFetch(async (request) => {
      if (new URL(request.url).pathname !== "/token") return request;
      const form = new URLSearchParams(await request.text());
      expect(form.get("code_verifier")).toBeTruthy();
      form.delete("code_verifier");
      return new Request(request.url, { method: "POST", headers: request.headers, body: form });
    });
    expect(errorOf(await app.request(location))).toBe("sign_in_failed");
    expect(await userByEmail(app, "alice@example.invalid")).toBeUndefined();
  });

  it("replaces the OIDC groups at the next sign-in and leaves local groups alone", async () => {
    const app = await oidcApp();
    await providerSignIn(app, { ...alice, groups: ["staff", "lab"] });
    const { id } = (await userByEmail(app, "alice@example.invalid"))!;
    await app.exec(`insert into "group" (id, name, source) values ('local-staff', 'staff', 'local')`);
    await app.exec(`insert into user_group (user_id, group_id) values ('${id}', 'local-staff')`);

    await providerSignIn(app.another(), { ...alice, groups: ["office"] });
    expect(await oidcGroupsOf(app, id as string)).toEqual(["office"]);
    expect(await app.query(`select group_id from user_group where user_id = '${id}' and group_id = 'local-staff'`)).toHaveLength(1);
    // A group that left the token stays, empty, as after an import.
    expect(await app.query(`select name from "group" where source = 'oidc' order by name`)).toEqual([{ name: "lab" }, { name: "office" }, { name: "staff" }]);
  });

  it("stamps the token's groups as seen, and keeps the stamp of a group that left the token", async () => {
    const app = await oidcApp();
    // Named by the catalog before any sign-in: the provider has not sent them yet.
    await app.exec(`insert into "group" (id, name, source) values ('o-lab', 'lab', 'oidc'), ('o-ops', 'ops', 'oidc')`);
    const seenAt = async () =>
      Object.fromEntries((await app.query(`select name, seen_at from "group" where source = 'oidc'`)).map((r) => [r.name, r.seen_at]));

    const before = Date.now() - 1000;
    await providerSignIn(app, { ...alice, groups: ["staff", "lab"] });
    const first = await seenAt();
    expect(first.ops).toBeNull();
    for (const name of ["staff", "lab"]) expect(Number(first[name])).toBeGreaterThanOrEqual(before);

    await app.exec(`update "group" set seen_at = 1000 where source = 'oidc' and seen_at is not null`);
    await providerSignIn(app.another(), { ...alice, groups: ["staff", "office"] });
    const second = await seenAt();
    expect(second.lab).toBe(1000);
    expect(second.ops).toBeNull();
    for (const name of ["staff", "office"]) expect(Number(second[name])).toBeGreaterThanOrEqual(before);

    await addUser(app, { id: "ada", email: "ada@example.invalid", role: "admin" });
    const admin = app.another();
    expect((await signIn(admin, "ada@example.invalid")).status).toBe(200);
    await app.exec(`insert into "group" (id, name, source) values ('l-staff', 'staff', 'local')`);
    const { groups } = (await (await admin.request("/api/admin/groups")).json()) as { groups: { source: string; name: string; seenAt: string | null }[] };
    const listed = Object.fromEntries(groups.map((g) => [`${g.source}:${g.name}`, g.seenAt]));
    expect(listed).toMatchObject({ "oidc:lab": new Date(1000).toISOString(), "oidc:ops": null, "local:staff": null, "system:everyone": null });
    expect(Date.parse(listed["oidc:office"]!)).toBe(Number(second.office));
  });

  it("keeps the role set in YASAD over the provider's", async () => {
    const app = await oidcApp({ OIDC_ADMIN_GROUPS: "admins" });
    await providerSignIn(app, { ...alice, groups: ["admins"] });
    await app.exec(`update "user" set role_override = 'user' where email = 'alice@example.invalid'`);
    await providerSignIn(app.another(), { ...alice, groups: ["admins"] });
    expect(await userByEmail(app, "alice@example.invalid")).toMatchObject({ role: "user" });

    await app.exec(`update "user" set role_override = 'admin' where email = 'alice@example.invalid'`);
    await providerSignIn(app.another(), { ...alice, groups: [] });
    expect(await userByEmail(app, "alice@example.invalid")).toMatchObject({ role: "admin" });

    await app.exec(`update "user" set role_override = null where email = 'alice@example.invalid'`);
    await providerSignIn(app.another(), { ...alice, groups: [] });
    expect(await userByEmail(app, "alice@example.invalid")).toMatchObject({ role: "user" });
  });

  it("copies the name and e-mail of the token at each sign-in", async () => {
    const app = await oidcApp();
    await providerSignIn(app, alice);
    const { id } = (await userByEmail(app, "alice@example.invalid"))!;
    await providerSignIn(app.another(), { ...alice, name: "Alice Martin", email: "alice.martin@example.invalid" });
    expect(await userByEmail(app, "alice.martin@example.invalid")).toMatchObject({ id, name: "Alice Martin" });
  });

  it("reads a single-string claim under a custom name", async () => {
    const app = await oidcApp({ OIDC_GROUPS_CLAIM: "roles" });
    await providerSignIn(app, { ...alice, groups: ["ignored"], roles: "  portal-users " });
    const { id } = (await userByEmail(app, "alice@example.invalid"))!;
    expect(await oidcGroupsOf(app, id as string)).toEqual(["portal-users"]);
  });

  it("signs in with no groups when the claim is missing", async () => {
    const app = await oidcApp();
    expect(errorOf(await providerSignIn(app, { ...alice, groups: undefined }))).toBeNull();
    expect(await oidcGroupsOf(app, (await userByEmail(app, "alice@example.invalid"))!.id as string)).toEqual([]);
  });

  it("writes more than 100 groups, with duplicates and blanks dropped", async () => {
    const app = await oidcApp();
    const groups = [...Array.from({ length: 150 }, (_, i) => `group-${i}`), "group-1", " group-2 ", "", "   "];
    expect(errorOf(await providerSignIn(app, { ...alice, groups }))).toBeNull();
    const { id } = (await userByEmail(app, "alice@example.invalid"))!;
    expect(await oidcGroupsOf(app, id as string)).toHaveLength(150);
    expect(await app.query(`select count(*) as n from "group" where source = 'oidc'`)).toEqual([{ n: 150 }]);
  });

  it("gives a new account to the same subject at another issuer", async () => {
    const app = await oidcApp({}, other);
    await addOidcUser(app, { id: "alice", email: "old-alice@example.invalid" });
    expect(errorOf(await providerSignIn(app, { ...alice, sub: "sub-alice" }, {}, other))).toBeNull();
    const row = await userByEmail(app, "alice@example.invalid");
    expect(row!.id).not.toBe("alice");
    expect(await app.query(`select account_id from account where user_id = '${row!.id}'`)).toEqual([{ account_id: "https://other-idp.test|sub-alice" }]);
  });
});

describe("provider sign-in refusals", () => {
  it("refuses a person in none of the allowed groups and writes nothing", async () => {
    const app = await oidcApp({ OIDC_ALLOWED_GROUPS: "portal-users, staff" });
    expect(errorOf(await providerSignIn(app, { ...alice, groups: ["guests"] }))).toBe("not_allowed");
    expect(await userByEmail(app, "alice@example.invalid")).toBeUndefined();
    expect(await app.query(`select name from "group" where source = 'oidc'`)).toEqual([]);
    expect(await sessionUser(app)).toBeNull();
    expect(errorOf(await providerSignIn(app.another(), { ...alice, groups: ["staff"] }))).toBeNull();
  });

  it("lets in a member of an admin group outside the allowed groups", async () => {
    const app = await oidcApp({ OIDC_ALLOWED_GROUPS: "portal-users", OIDC_ADMIN_GROUPS: "admins" });
    expect(errorOf(await providerSignIn(app, { ...alice, groups: ["admins"] }))).toBeNull();
    expect(await sessionUser(app)).toMatchObject({ role: "admin" });
  });

  it("refuses a returning person no longer allowed, and changes nothing", async () => {
    const app = await oidcApp({ OIDC_ALLOWED_GROUPS: "staff", OIDC_ADMIN_GROUPS: "admins" });
    await providerSignIn(app, { ...alice, groups: ["staff", "admins"] });
    const before = await userByEmail(app, "alice@example.invalid");
    const [token] = await app.query(`select id_token from account where provider_id = 'oidc'`);

    const res = await providerSignIn(app.another(), { ...alice, name: "Renamed", groups: ["guests"] });
    expect(errorOf(res)).toBe("not_allowed");
    expect(await userByEmail(app, "alice@example.invalid")).toEqual(before);
    expect(await oidcGroupsOf(app, before!.id as string)).toEqual(["admins", "staff"]);
    expect(await app.query(`select id_token from account where provider_id = 'oidc'`)).toEqual([token]);
  });

  it("refuses an address the provider marks unverified", async () => {
    const app = await oidcApp();
    expect(errorOf(await providerSignIn(app, { ...alice, email_verified: false }))).toBe("not_allowed");
    expect(await userByEmail(app, "alice@example.invalid")).toBeUndefined();
  });

  it("never links to a local account with the same e-mail, verified or not", async () => {
    for (const verified of [0, 1]) {
      const app = await oidcApp();
      await addUser(app, { id: "local", email: "alice@example.invalid" });
      await app.exec(`update "user" set email_verified = ${verified} where id = 'local'`);
      expect(errorOf(await providerSignIn(app, alice)), `email_verified = ${verified}`).toBe("account_not_linked");
      expect(await app.query(`select provider_id from account where user_id = 'local'`)).toEqual([{ provider_id: "credential" }]);
      expect(await sessionUser(app)).toBeNull();
    }
  });

  it("never links to the account of another issuer with the same e-mail", async () => {
    // As after a change of provider: the old issuer's account keeps its verified address.
    const app = await oidcApp({}, other);
    await addOidcUser(app, { id: "old", email: "alice@example.invalid" });
    await app.exec(`update "user" set email_verified = 1 where id = 'old'`);
    expect(errorOf(await providerSignIn(app, alice, {}, other))).toBe("account_not_linked");
    expect(await app.query(`select account_id from account where user_id = 'old'`)).toEqual([{ account_id: "https://idp.test|sub-old" }]);
    expect(await app.query(`select count(*) as n from account`)).toEqual([{ n: 1 }]);
    expect(await sessionUser(app)).toBeNull();
  });

  it("refuses a returning person whose new e-mail belongs to another account", async () => {
    const app = await oidcApp();
    await providerSignIn(app, alice);
    await addUser(app, { id: "bob", email: "bob@example.invalid" });
    expect(errorOf(await providerSignIn(app.another(), { ...alice, email: "bob@example.invalid" }))).toBe("email_in_use");
    expect(await userByEmail(app, "alice@example.invalid")).toMatchObject({ name: "Alice" });
  });

  it("refuses a disabled account, opens no session and changes nothing", async () => {
    const app = await oidcApp();
    await addOidcUser(app, { id: "bob", email: "bob@example.invalid" });
    await app.exec(`update "user" set disabled = 1 where id = 'bob'`);
    const before = await app.query(`select name, email, updated_at from "user" where id = 'bob'`);
    const claims = { sub: "sub-bob", email: "robert@example.invalid", email_verified: true, name: "Robert", groups: ["staff"] };
    expect(errorOf(await providerSignIn(app, claims))).toBe("account_disabled");
    expect(await app.query(`select name, email, updated_at from "user" where id = 'bob'`)).toEqual(before);
    expect(await app.query(`select id_token, access_token from account where user_id = 'bob'`)).toEqual([{ id_token: null, access_token: null }]);
    expect(await app.query(`select id from session where user_id = 'bob'`)).toEqual([]);
    expect(await oidcGroupsOf(app, "bob")).toEqual([]);
    expect(await sessionUser(app)).toBeNull();
  });

  it("refuses an account disabled while its session is being created", async () => {
    const app = await oidcApp();
    await addOidcUser(app, { id: "bob", email: "bob@example.invalid" });
    // Stands for an admin disabling the account between the hook's check and the session insert.
    await app.exec(`create trigger disable_bob after insert on session begin update "user" set disabled = 1 where id = new.user_id; end`);
    try {
      expect(errorOf(await providerSignIn(app, { sub: "sub-bob", email: "bob@example.invalid", email_verified: true }))).toBe("account_disabled");
      expect(await app.query(`select id from session where user_id = 'bob'`)).toEqual([]);
      expect(await sessionUser(app)).toBeNull();
    } finally {
      await app.exec(`drop trigger disable_bob`);
    }
  });

  it("forwards access_denied from the provider", async () => {
    const app = await oidcApp();
    provider.faults.authorizeError = "access_denied";
    expect(errorOf(await providerSignIn(app, alice))).toBe("access_denied");
  });

  it("sends any other provider error as sign_in_failed", async () => {
    const app = await oidcApp();
    provider.faults.authorizeError = "server_error";
    expect(errorOf(await providerSignIn(app, alice))).toBe("sign_in_failed");
  });

  for (const fault of ["missing", "bad-signature", "wrong-audience", "wrong-issuer", "wrong-nonce", "expired"] as const) {
    it(`refuses an ID token that is ${fault}`, async () => {
      const app = await oidcApp();
      provider.faults.idToken = fault;
      expect(errorOf(await providerSignIn(app, alice))).toBe("sign_in_failed");
      expect(await userByEmail(app, "alice@example.invalid")).toBeUndefined();
      expect(await sessionUser(app)).toBeNull();
    });
  }

  it("turns a failed write into sign_in_failed and opens no session", async () => {
    const app = await oidcApp();
    await app.exec(`create trigger fail_membership before insert on user_group begin select raise(abort, 'sabotaged'); end`);
    try {
      expect(errorOf(await providerSignIn(app, alice))).toBe("sign_in_failed");
      expect(await app.query(`select id from session`)).toEqual([]);
      expect(await sessionUser(app)).toBeNull();
    } finally {
      await app.exec(`drop trigger fail_membership`);
    }
  });
});

describe("provider sign-in start", () => {
  it("ignores an idToken sent in the body", async () => {
    const app = await oidcApp();
    // A genuine ID token for this client, signed by the provider.
    const verifier = "a-verifier-long-enough-for-the-fake-provider";
    const authorizeUrl = new URL(`${provider.issuer}/authorize`);
    authorizeUrl.search = new URLSearchParams({
      client_id: provider.clientId,
      response_type: "code",
      redirect_uri: "https://yasad.test/cb",
      code_challenge: await s256(verifier),
      code_challenge_method: "S256",
    }).toString();
    const authorized = await provider.handle(new Request(provider.as(authorizeUrl.toString(), alice)));
    const code = new URL(authorized.headers.get("location")!).searchParams.get("code")!;
    const tokens = (await (
      await provider.handle(
        new Request(`${provider.issuer}/token`, {
          method: "POST",
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: "https://yasad.test/cb",
            client_id: provider.clientId,
            client_secret: provider.clientSecret,
            code_verifier: verifier,
          }),
        }),
      )
    ).json()) as { id_token: string };

    const res = await start(app, { provider: "oidc", idToken: { token: tokens.id_token }, callbackURL: "https://evil.example/" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["url"]);
    expect(await sessionUser(app)).toBeNull();
    expect(await userByEmail(app, "alice@example.invalid")).toBeUndefined();
  });

  it("answers 503 when discovery fails", async () => {
    const app = await oidcApp();
    provider.faults.discovery = "unavailable";
    const res = await start(app);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "provider_unavailable" } });
  });

  it("answers 503 when discovery lists no signing algorithms", async () => {
    // Better Auth would then accept whatever algorithm the token header names.
    const app = await oidcApp();
    provider.faults.noSigningAlgs = true;
    const res = await start(app);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "provider_unavailable" } });
  });

  it("answers 503 when Better Auth's own discovery read lists no signing algorithms", async () => {
    const app = await oidcApp();
    provider.faults.noSigningAlgs = "after-first";
    const res = await start(app);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "provider_unavailable" } });
    expect(provider.requests.filter((r) => new URL(r.url).pathname === "/.well-known/openid-configuration")).toHaveLength(2);
  });

  it("answers 503 when an endpoint is in http under an https PUBLIC_URL", async () => {
    const app = await oidcApp();
    provider.faults.insecureTokenEndpoint = true;
    const res = await start(app);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "provider_unavailable" } });
  });

  it("answers 503 when Better Auth's own discovery read hangs", { timeout: 30_000 }, async () => {
    const app = await oidcApp();
    provider.faults.discovery = "hang-after-first";
    const res = await start(app);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "provider_unavailable" } });
  });

  it("answers 503 when discovery hangs", { timeout: 30_000 }, async () => {
    const app = await oidcApp();
    provider.faults.discovery = "hang";
    const res = await start(app);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "provider_unavailable" } });
  });

  it("limits starts per IP, with Retry-After", async () => {
    const app = await oidcApp();
    await app.exec(`insert into rate_limit (key, count, window_start) values ('oidc-start:${TEST_IP}', 300, ${Date.now()})`);
    const res = await start(app);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: { code: "rate_limited" } });
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await post(app, "/api/auth/sign-in/social", {}, "198.51.100.7")).status).toBe(200);
  });
});

describe("provider callback", () => {
  it("refuses a callback without state, from another browser, replayed or expired, before calling the provider", async () => {
    const app = await oidcApp();
    expect(errorOf(await app.request("/api/auth/callback/oidc?code=x"))).toBe("state_mismatch");

    const location = await authorize(app, alice);
    provider.requests = [];
    expect(errorOf(await app.another().request(location))).toBe("state_mismatch");
    expect(provider.requests).toEqual([]);

    expect(errorOf(await app.request(location))).toBeNull();
    expect(errorOf(await app.another().request(location))).toBe("state_mismatch");
    expect(errorOf(await app.request(location))).toBe("state_mismatch");

    const late = await oidcApp();
    const expired = await authorize(late, alice);
    await late.exec(`update verification set expires_at = ${Date.now() - 1000}`);
    expect(errorOf(await late.request(expired))).toBe("state_mismatch");
  });

  it("sends the browser back with provider_unavailable when discovery fails", async () => {
    const app = await oidcApp();
    const location = await authorize(app, alice);
    provider.faults.discovery = "unavailable";
    expect(errorOf(await app.request(location))).toBe("provider_unavailable");
  });

  it("sends the browser back with provider_unavailable when discovery hangs", { timeout: 30_000 }, async () => {
    const app = await oidcApp();
    const location = await authorize(app, alice);
    provider.faults.discovery = "hang";
    expect(errorOf(await app.request(location))).toBe("provider_unavailable");
  });

  it("sends the browser back with provider_unavailable when Better Auth's discovery read lists no signing algorithms", async () => {
    const app = await oidcApp();
    const location = await authorize(app, alice);
    provider.faults.noSigningAlgs = "after-first";
    expect(errorOf(await app.request(location))).toBe("provider_unavailable");
    expect(await userByEmail(app, "alice@example.invalid")).toBeUndefined();
  });

  it("sends the browser back with provider_unavailable when the code exchange hangs", { timeout: 30_000 }, async () => {
    const app = await oidcApp();
    const location = await authorize(app, alice);
    provider.faults.token = "hang";
    expect(errorOf(await app.request(location))).toBe("provider_unavailable");
  });

  it("limits callbacks per IP", async () => {
    const app = await oidcApp();
    const location = await authorize(app, alice);
    await app.exec(`insert into rate_limit (key, count, window_start) values ('oidc-callback:${TEST_IP}', 300, ${Date.now()})`);
    expect(errorOf(await app.request(location))).toBe("rate_limited");
  });
});

describe("sign-out", () => {
  it("returns the provider's end-session address for an OIDC account", async () => {
    const app = await oidcApp();
    await providerSignIn(app, alice);
    const [account] = await app.query(`select id_token from account where provider_id = 'oidc'`);
    const res = await post(app, "/api/auth/sign-out", {});
    expect(res.status).toBe(200);
    const { success, url } = (await res.json()) as { success: boolean; url: string };
    expect(success).toBe(true);
    const target = new URL(url);
    expect(`${target.origin}${target.pathname}`).toBe("https://idp.test/end-session");
    expect(target.searchParams.get("id_token_hint")).toBe(account!.id_token);
    expect(target.searchParams.get("post_logout_redirect_uri")).toBe("https://yasad.test/signed-out");
    expect(target.searchParams.get("client_id")).toBe(provider.clientId);
    expect(await sessionUser(app)).toBeNull();
    expect(await app.query(`select id from session`)).toEqual([]);
  });

  it("signs out locally when the provider is down or offers no end session", async () => {
    for (const fault of [{ discovery: "unavailable" as const }, { noEndSession: true }]) {
      const app = await oidcApp();
      await providerSignIn(app, alice);
      provider.faults = fault;
      const res = await post(app, "/api/auth/sign-out", {});
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(await sessionUser(app)).toBeNull();
      provider.faults = {};
    }
  });

  it("returns no address for a local account", async () => {
    const app = await oidcApp();
    await addUser(app, { id: "local", email: "local@example.invalid" });
    expect((await signIn(app, "local@example.invalid")).status).toBe(200);
    const res = await post(app, "/api/auth/sign-out", {});
    expect(await res.json()).toEqual({ success: true });
    expect(provider.requests).toEqual([]);
  });
});
