import { BASE_ENV, type TestApp, testApp } from "#harness";
import { describe, expect, it } from "vitest";

import { addOidcUser, addUser, post, send, signIn } from "./users";

type Icon = { set: "si" | "lucide"; name: string };
type HomeBody = {
  signedIn: boolean;
  categories: { id: string; title: string; links: { id: string; title: string; description: string; url: string; icon: Icon | null }[] }[];
  empty: string | null;
};

type LinkSpec = { id: string; groups: string[]; title?: string; description?: string; icon?: string; active?: boolean; keywords?: string[] };
type CategorySpec = { id: string; groups: string[]; links: LinkSpec[] };

/** Return a catalog file (JSON is valid YAML) with a title and URL derived from each id. */
function catalog(categories: CategorySpec[]): string {
  return JSON.stringify({
    version: 1,
    categories: categories.map((cat) => ({
      id: cat.id,
      title: `Category ${cat.id}`,
      groups: cat.groups,
      links: cat.links.map(({ id, title, ...rest }) => ({ id, title: title ?? `Link ${id}`, url: `https://${id}.example.invalid/`, ...rest })),
    })),
  });
}

/** Return a client signed in as an administrator, on a fresh database. */
async function adminApp(): Promise<TestApp> {
  const app = await testApp();
  await addUser(app, { id: "admin", email: "admin@example.invalid", role: "admin" });
  expect((await signIn(app, "admin@example.invalid")).status).toBe(200);
  return app;
}

/** Import a catalog as the admin page does: preview, then apply with its baseVersion. */
async function load(admin: TestApp, categories: CategorySpec[]) {
  const yaml = catalog(categories);
  const preview = await post(admin, "/api/admin/catalog", { yaml, dryRun: true });
  expect(preview.status).toBe(200);
  const { baseVersion } = (await preview.json()) as { baseVersion: string };
  const applied = await post(admin, "/api/admin/catalog", { yaml, dryRun: false, baseVersion });
  expect(applied.status).toBe(200);
}

/** Return a second browser signed in as a new local user. */
async function localUser(admin: TestApp, id: string, role: "admin" | "user" = "user"): Promise<TestApp> {
  const browser = admin.another();
  await addUser(browser, { id, email: `${id}@example.invalid`, role });
  expect((await signIn(browser, `${id}@example.invalid`)).status).toBe(200);
  return browser;
}

/** Return the id of a group, by source and name. */
async function groupId(app: TestApp, source: string, name: string): Promise<string> {
  const rows = await app.query(`select id from "group" where source = '${source}' and name = '${name}'`);
  expect(rows).toHaveLength(1);
  return rows[0]!.id as string;
}

/** Add a membership row directly, as the OIDC sign-in hook will. */
async function addMembership(app: TestApp, userId: string, source: string, name: string) {
  await app.exec(`insert into user_group (user_id, group_id) select '${userId}', id from "group" where source = '${source}' and name = '${name}'`);
}

/** Put a user in a local group through the admin API. */
async function join(admin: TestApp, userId: string, name: string) {
  expect((await send(admin, "PUT", `/api/admin/groups/${await groupId(admin, "local", name)}/members/${userId}`)).status).toBe(204);
}

async function home(app: TestApp) {
  const res = await app.request("/api/home");
  const text = await res.text();
  return { res, text, body: JSON.parse(text) as HomeBody };
}

/** Return the ids of the links the client sees, in order. */
async function linkIds(app: TestApp): Promise<string[]> {
  const { res, body } = await home(app);
  expect(res.status).toBe(200);
  return body.categories.flatMap((cat) => cat.links.map((lnk) => lnk.id));
}

describe("GET /api/home, anonymous", () => {
  it("shows @everyone links in @everyone categories, without an Origin header", async () => {
    const admin = await adminApp();
    await load(admin, [{ id: "public", groups: ["@everyone"], links: [{ id: "wiki", groups: ["@everyone"] }] }]);
    const res = await admin.another().request("/api/home", { headers: { origin: "" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as HomeBody;
    expect(body.signedIn).toBe(false);
    expect(body.empty).toBeNull();
    expect(body.categories.map((c) => c.id)).toEqual(["public"]);
  });

  it("never shows @authenticated content, on the link or on the category", async () => {
    const admin = await adminApp();
    await load(admin, [
      { id: "public", groups: ["@everyone"], links: [{ id: "members-only", groups: ["@authenticated"] }, { id: "wiki", groups: ["@everyone"] }] },
      { id: "private", groups: ["@authenticated"], links: [{ id: "hidden", groups: ["@everyone"] }] },
    ]);
    const anonymous = admin.another();
    expect(await linkIds(anonymous)).toEqual(["wiki"]);
    const { text } = await home(anonymous);
    expect(text).not.toContain("members-only");
    expect(text).not.toContain("hidden");
  });

  it("returns an empty list and no state, whether the catalog is empty or not", async () => {
    const admin = await adminApp();
    expect((await home(admin.another())).body).toEqual({ signedIn: false, categories: [], empty: null });
    await load(admin, [{ id: "private", groups: ["@authenticated"], links: [{ id: "intranet", groups: ["@authenticated"] }] }]);
    expect((await home(admin.another())).body).toEqual({ signedIn: false, categories: [], empty: null });
  });

  it("treats an invalid or expired session cookie as anonymous", async () => {
    const admin = await adminApp();
    await load(admin, [{ id: "public", groups: ["@everyone"], links: [{ id: "wiki", groups: ["@everyone"] }] }]);
    const forged = await admin.another().request("/api/home", { headers: { cookie: "better-auth.session_token=forged.value" } });
    expect(forged.status).toBe(200);
    expect(((await forged.json()) as HomeBody).signedIn).toBe(false);

    const user = await localUser(admin, "eve");
    await admin.exec(`update session set expires_at = 0 where user_id = 'eve'`);
    const { res, body } = await home(user);
    expect(res.status).toBe(200);
    expect(body.signedIn).toBe(false);
    expect(body.categories.flatMap((c) => c.links.map((l) => l.id))).toEqual(["wiki"]);
  });
});

describe("GET /api/home, visibility rules", () => {
  it("shows @everyone and @authenticated links to a signed-in person", async () => {
    const admin = await adminApp();
    await load(admin, [
      { id: "public", groups: ["@everyone"], links: [{ id: "wiki", groups: ["@everyone"] }] },
      { id: "private", groups: ["@authenticated"], links: [{ id: "intranet", groups: ["@authenticated"] }] },
    ]);
    const user = await localUser(admin, "bob");
    const { body } = await home(user);
    expect(body.signedIn).toBe(true);
    expect(await linkIds(user)).toEqual(["wiki", "intranet"]);
  });

  it("denies by default: no group on the link, or none on the category, hides it from everyone", async () => {
    const admin = await adminApp();
    await load(admin, [
      { id: "open", groups: ["@everyone"], links: [{ id: "no-group", groups: [] }, { id: "wiki", groups: ["@everyone"] }] },
      { id: "closed", groups: [], links: [{ id: "orphan", groups: ["@everyone"] }] },
    ]);
    const user = await localUser(admin, "bob");
    for (const app of [admin, user, admin.another()]) expect(await linkIds(app)).toEqual(["wiki"]);
  });

  it("needs a held group on the link AND on its category, not necessarily the same", async () => {
    const admin = await adminApp();
    await load(admin, [
      { id: "cat-a", groups: ["local:A"], links: [{ id: "link-only-b", groups: ["local:B"] }] },
      { id: "cat-c", groups: ["local:C"], links: [{ id: "cat-only", groups: ["local:A"] }] },
      { id: "cat-b", groups: ["local:B"], links: [{ id: "mixed", groups: ["local:A"] }] },
    ]);
    const onlyA = await localUser(admin, "alice");
    await join(admin, "alice", "A");
    expect(await linkIds(onlyA)).toEqual([]);

    const both = await localUser(admin, "bob");
    await join(admin, "bob", "A");
    await join(admin, "bob", "B");
    expect(await linkIds(both)).toEqual(["link-only-b", "mixed"]);
  });

  it("never sends one group's links to a member of another group", async () => {
    const admin = await adminApp();
    await load(admin, [
      {
        id: "tools",
        groups: ["local:A", "local:B"],
        links: [
          { id: "link-a", title: "Alpha console", groups: ["local:A"] },
          { id: "link-b", title: "Bravo console", groups: ["local:B"] },
        ],
      },
    ]);
    const a = await localUser(admin, "alice");
    const b = await localUser(admin, "bob");
    const ab = await localUser(admin, "carol");
    await join(admin, "alice", "A");
    await join(admin, "bob", "B");
    await join(admin, "carol", "A");
    await join(admin, "carol", "B");

    expect(await linkIds(a)).toEqual(["link-a"]);
    expect(await linkIds(b)).toEqual(["link-b"]);
    expect(await linkIds(ab)).toEqual(["link-a", "link-b"]);
    const { text } = await home(a);
    expect(text).not.toContain("link-b");
    expect(text).not.toContain("Bravo console");
    expect(text).not.toContain("https://link-b.example.invalid/");
  });

  it("hides inactive links, and a category whose only allowed links are inactive", async () => {
    const admin = await adminApp();
    await load(admin, [
      { id: "mixed", groups: ["@authenticated"], links: [{ id: "old", groups: ["@authenticated"], active: false }, { id: "new", groups: ["@authenticated"] }] },
      { id: "retired", groups: ["@authenticated"], links: [{ id: "gone", groups: ["@authenticated"], active: false }] },
    ]);
    const user = await localUser(admin, "bob");
    const { body } = await home(user);
    expect(body.categories.map((c) => c.id)).toEqual(["mixed"]);
    expect(await linkIds(user)).toEqual(["new"]);
  });

  it("keeps OIDC and local groups of the same name apart", async () => {
    const admin = await adminApp();
    await load(admin, [
      { id: "both", groups: ["oidc:Developers", "local:Developers"], links: [{ id: "oidc-only", groups: ["oidc:Developers"] }] },
      { id: "local", groups: ["local:Developers"], links: [{ id: "local-only", groups: ["local:Developers"] }] },
    ]);
    const local = await localUser(admin, "lou");
    await join(admin, "lou", "Developers");
    expect(await linkIds(local)).toEqual(["local-only"]);

    const browser = admin.another();
    await addOidcUser(browser, { id: "olga", email: "olga@example.invalid" });
    // An OIDC account cannot sign in by password in tests: give it a session directly.
    await browser.exec(
      `insert into session (id, expires_at, token, user_id) values ('s-olga', ${Date.now() + 3_600_000}, 'olga-token', 'olga')`,
    );
    const signedToken = await signedCookie("olga-token");
    const asOlga = () => browser.request("/api/home", { headers: { cookie: `__Secure-better-auth.session_token=${signedToken}` } });

    await addMembership(admin, "olga", "oidc", "Developers");
    let body = (await (await asOlga()).json()) as HomeBody;
    expect(body.signedIn).toBe(true);
    expect(body.categories.flatMap((c) => c.links.map((l) => l.id))).toEqual(["oidc-only"]);

    await admin.exec(`delete from user_group where user_id = 'olga'`);
    await addMembership(admin, "olga", "local", "Developers");
    body = (await (await asOlga()).json()) as HomeBody;
    expect(body.categories.flatMap((c) => c.links.map((l) => l.id))).toEqual(["local-only"]);
  });

  it("matches group names exactly: local:Dev does not open local:dev", async () => {
    const admin = await adminApp();
    await load(admin, [
      {
        id: "tools",
        groups: ["@authenticated"],
        links: [
          { id: "lower", groups: ["local:dev"] },
          { id: "upper", groups: ["local:Dev"] },
        ],
      },
    ]);
    const user = await localUser(admin, "bob");
    await join(admin, "bob", "Dev");
    expect(await linkIds(user)).toEqual(["upper"]);
  });

  it("gives administrators no bypass", async () => {
    const admin = await adminApp();
    await load(admin, [{ id: "tools", groups: ["local:Ops"], links: [{ id: "console", groups: ["local:Ops"] }] }]);
    const { body } = await home(admin);
    expect(body).toEqual({ signedIn: true, categories: [], empty: "admin_no_access" });
  });

  it("applies changes at the next request: membership, deactivation, group deletion", async () => {
    const admin = await adminApp();
    const file: CategorySpec[] = [{ id: "tools", groups: ["local:Ops"], links: [{ id: "console", groups: ["local:Ops"] }] }];
    await load(admin, file);
    const user = await localUser(admin, "bob");
    expect(await linkIds(user)).toEqual([]);
    await join(admin, "bob", "Ops");
    expect(await linkIds(user)).toEqual(["console"]);

    const ops = await groupId(admin, "local", "Ops");
    expect((await send(admin, "DELETE", `/api/admin/groups/${ops}/members/bob`)).status).toBe(204);
    expect(await linkIds(user)).toEqual([]);

    await join(admin, "bob", "Ops");
    await load(admin, [{ ...file[0]!, links: [{ id: "console", groups: ["local:Ops"], active: false }] }]);
    expect(await linkIds(user)).toEqual([]);

    await load(admin, file);
    expect(await linkIds(user)).toEqual(["console"]);
    expect((await send(admin, "DELETE", `/api/admin/groups/${ops}`)).status).toBe(204);
    expect(await linkIds(user)).toEqual([]);
  });

  it("handles a person in many groups (more than D1's 100 bound parameters)", async () => {
    const admin = await adminApp();
    const values = Array.from({ length: 150 }, (_, i) => `('g-${i + 1}', 'G${i + 1}', 'local')`).join(", ");
    await admin.exec(`insert into "group" (id, name, source) values ${values}`);
    const user = await localUser(admin, "bob");
    await admin.exec(`insert into user_group (user_id, group_id) select 'bob', id from "group" where id like 'g-%'`);
    await load(admin, [{ id: "tools", groups: ["@authenticated"], links: [{ id: "last", groups: ["local:G150"] }] }]);
    expect(await linkIds(user)).toEqual(["last"]);
  });
});

describe("GET /api/home, response", () => {
  it("sends only the display fields, in catalog order", async () => {
    const admin = await adminApp();
    await load(admin, [
      {
        id: "second-by-id",
        groups: ["@authenticated"],
        links: [
          { id: "zeta", groups: ["@authenticated"], description: "Last letter", icon: "si:github", keywords: ["code"] },
          { id: "alpha", groups: ["@authenticated"] },
        ],
      },
      { id: "after", groups: ["@authenticated"], links: [{ id: "mail", groups: ["@authenticated"], icon: "lucide:mail" }] },
    ]);
    const { body } = await home(admin);
    expect(body).toEqual({
      signedIn: true,
      categories: [
        {
          id: "second-by-id",
          title: "Category second-by-id",
          links: [
            { id: "zeta", title: "Link zeta", description: "Last letter", url: "https://zeta.example.invalid/", icon: { set: "si", name: "github" } },
            { id: "alpha", title: "Link alpha", description: "", url: "https://alpha.example.invalid/", icon: null },
          ],
        },
        {
          id: "after",
          title: "Category after",
          links: [{ id: "mail", title: "Link mail", description: "", url: "https://mail.example.invalid/", icon: { set: "lucide", name: "mail" } }],
        },
      ],
      empty: null,
    });
  });

  it("canonicalizes Lucide aliases and sends null for unknown or excluded icons", async () => {
    const admin = await adminApp();
    await load(admin, [
      {
        id: "tools",
        groups: ["@everyone"],
        links: [
          { id: "alias", groups: ["@authenticated"], icon: "lucide:activity-square" },
          { id: "unknown-si", groups: ["@authenticated"], icon: "si:no_such_brand" },
          { id: "unknown-lucide", groups: ["@authenticated"], icon: "lucide:no-such-icon" },
          // Simple Icons under a CC-BY-NC licence: left out by the generator.
          { id: "excluded", groups: ["@authenticated"], icon: "si:cocoapods" },
          { id: "public", groups: ["@everyone"], icon: "si:github" },
        ],
      },
    ]);
    const icons = Object.fromEntries((await home(admin)).body.categories[0]!.links.map((l) => [l.id, l.icon]));
    expect(icons).toEqual({
      alias: { set: "lucide", name: "square-activity" },
      "unknown-si": null,
      "unknown-lucide": null,
      excluded: null,
      public: { set: "si", name: "github" },
    });
    const anonymous = await home(admin.another());
    expect(anonymous.body.categories[0]!.links.map((l) => l.icon)).toEqual([{ set: "si", name: "github" }]);
    expect(anonymous.text).not.toContain("square-activity");
  });

  it("is never cached by a shared cache", async () => {
    const admin = await adminApp();
    expect((await admin.request("/api/home")).headers.get("cache-control")).toBe("private, no-store");
    expect((await admin.another().request("/api/home")).headers.get("cache-control")).toBe("private, no-store");
  });

  it("answers only GET", async () => {
    const admin = await adminApp();
    expect((await send(admin, "POST", "/api/home")).status).toBe(404);
  });
});

describe("GET /api/home, empty states", () => {
  it("tells an admin the catalog is empty, and another person they have no group", async () => {
    const admin = await adminApp();
    expect((await home(admin)).body).toEqual({ signedIn: true, categories: [], empty: "catalog_empty" });
    const user = await localUser(admin, "bob");
    expect((await home(user)).body.empty).toBe("no_groups");
  });

  it("separates no group at all from groups that open nothing", async () => {
    const admin = await adminApp();
    await load(admin, [{ id: "tools", groups: ["local:Ops"], links: [{ id: "console", groups: ["local:Ops"] }] }]);
    expect((await post(admin, "/api/admin/groups", { name: "Sales" })).status).toBe(201);
    const user = await localUser(admin, "bob");
    expect((await home(user)).body.empty).toBe("no_groups");
    await join(admin, "bob", "Sales");
    expect((await home(user)).body.empty).toBe("nothing_visible");
    expect((await home(admin)).body.empty).toBe("admin_no_access");
  });

  it("tells an admin the catalog is empty when every link is inactive", async () => {
    const admin = await adminApp();
    await load(admin, [{ id: "tools", groups: ["@authenticated"], links: [{ id: "console", groups: ["@authenticated"], active: false }] }]);
    expect((await home(admin)).body).toEqual({ signedIn: true, categories: [], empty: "catalog_empty" });
  });

  it("is null when something is visible", async () => {
    const admin = await adminApp();
    await load(admin, [{ id: "tools", groups: ["@authenticated"], links: [{ id: "console", groups: ["@authenticated"] }] }]);
    expect((await home(admin)).body.empty).toBeNull();
  });
});

describe("GET /api/home, temporary password", () => {
  it("is refused until the password is changed", async () => {
    const admin = await adminApp();
    const browser = admin.another();
    await addUser(browser, { id: "tmp", email: "tmp@example.invalid", mustChangePassword: true });
    expect((await signIn(browser, "tmp@example.invalid")).status).toBe(200);
    const res = await browser.request("/api/home");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("password_change_required");
  });
});

/** Return a Better Auth session cookie value: the token signed with AUTH_SECRET (HMAC-SHA256, base64). */
async function signedCookie(token: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(BASE_ENV.AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  const base64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return encodeURIComponent(`${token}.${base64}`);
}
