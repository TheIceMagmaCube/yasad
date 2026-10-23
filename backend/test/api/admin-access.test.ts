import { type TestApp, testApp } from "#harness";
import { describe, expect, it } from "vitest";

import { addMembership, catalog, type CategorySpec, groupId, join, localUser } from "./home-catalog";
import { addOidcUser, addUser, post, send, sessionCookie, signIn } from "./users";

type HomeBody = {
  signedIn: boolean;
  categories: { id: string; links: { id: string; status?: { state: string } }[] }[];
  empty: string | null;
  pins: string[];
};
type Named = { id: string; name: string; source: string };
type Reason = { code: string; hint?: { kind: string; held: Named; expected: Named } };
type Explanation = { id: string; title: string; categoryId: string; categoryTitle: string; visible: boolean; reasons: Reason[]; pinned?: true };
type Audience = { people: number; public: boolean };

const MINUTE = 60_000;

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
  expect((await post(admin, "/api/admin/catalog", { yaml, dryRun: false, baseVersion })).status).toBe(200);
}

async function getJson<T>(app: TestApp, path: string): Promise<T> {
  const res = await app.request(path);
  expect(res.status, path).toBe(200);
  return (await res.json()) as T;
}

const preview = (admin: TestApp, userId: string) => getJson<HomeBody>(admin, `/api/admin/access/users/${userId}/home`);
const explain = async (admin: TestApp, userId: string) =>
  (await getJson<{ links: Explanation[] }>(admin, `/api/admin/access/users/${userId}/links`)).links;
const explainOne = async (admin: TestApp, userId: string, linkId: string) =>
  (await getJson<{ explanation: Explanation }>(admin, `/api/admin/access/links/${linkId}?as=${userId}`)).explanation;
const linkAudience = async (admin: TestApp, linkId: string) => (await getJson<{ audience: Audience }>(admin, `/api/admin/access/links/${linkId}`)).audience;
const categoryAudience = async (admin: TestApp, id: string) => (await getJson<{ audience: Audience }>(admin, `/api/admin/access/categories/${id}`)).audience;
const ids = (body: HomeBody) => body.categories.flatMap((cat) => cat.links.map((lnk) => lnk.id));

/** Return a function reading `/api/home` as an OIDC person, through a session written straight in the database. */
async function oidcPerson(admin: TestApp, id: string): Promise<() => Promise<Response>> {
  const browser = admin.another();
  await addOidcUser(browser, { id, email: `${id}@example.invalid` });
  const cookie = await sessionCookie(browser, id);
  return () => browser.request("/api/home", { headers: { cookie } });
}

const MATRIX: CategorySpec[] = [
  {
    id: "tools",
    groups: ["local:Dev", "oidc:Dev", "local:dev", "local:G150"],
    links: [
      { id: "local-dev", groups: ["local:Dev"] },
      { id: "oidc-dev", groups: ["oidc:Dev"] },
      { id: "lower", groups: ["local:dev"] },
      { id: "old", groups: ["local:Dev", "oidc:Dev"], active: false },
      { id: "checked", groups: ["local:Dev", "oidc:Dev"], check: true },
      { id: "g150", groups: ["local:G150"] },
    ],
  },
  { id: "closed", groups: [], links: [{ id: "orphan", groups: ["@authenticated"] }] },
  { id: "public", groups: ["@everyone"], links: [{ id: "wiki", groups: ["@everyone"] }, { id: "members", groups: ["@authenticated"] }] },
  { id: "ops", groups: ["local:Ops"], links: [{ id: "console", groups: ["local:Ops"] }] },
];

/**
 * Seed the parity matrix and return how each person reads their own `/api/home`: local and OIDC members of
 * `Dev`, a member of `dev` only, the admin, a person in 150 groups, and one in none.
 */
async function seedMatrix(admin: TestApp): Promise<Record<string, () => Promise<Response>>> {
  await load(admin, MATRIX);
  const at = Date.now() - MINUTE;
  await admin.exec(
    `insert into link_status (link_id, source, state, reason, http_status, checked_at, due_at) values ('checked', 'yasad', 'down', 'http_error', 502, ${at}, ${at + 60 * MINUTE})`,
  );
  const values = Array.from({ length: 149 }, (_, i) => `('g-${i + 1}', 'G${i + 1}', 'local')`).join(", ");
  await admin.exec(`insert into "group" (id, name, source) values ${values}`);

  const lou = await localUser(admin, "lou");
  await join(admin, "lou", "Dev");
  expect((await post(lou, "/api/pins", { linkId: "local-dev" })).status).toBe(200);
  // A pin kept while its link is hidden: it must stay out of the preview, as at home.
  await admin.exec(`insert into user_link_pin (user_id, link_id, position) values ('lou', 'console', 5)`);

  const casey = await localUser(admin, "casey");
  await join(admin, "casey", "dev");
  const many = await localUser(admin, "many");
  await admin.exec(`insert into user_group (user_id, group_id) select 'many', id from "group" where source = 'local' and name like 'G%'`);
  const nobody = await localUser(admin, "nobody");
  const olga = await oidcPerson(admin, "olga");
  await addMembership(admin, "olga", "oidc", "Dev");

  const home = (app: TestApp) => () => app.request("/api/home");
  return { lou: home(lou), casey: home(casey), many: home(many), nobody: home(nobody), olga, admin: home(admin) };
}

describe("GET /api/admin/access/users/:id/home", () => {
  it("is the person's own /api/home, status included, and explains exactly what it shows", async () => {
    const admin = await adminApp();
    const people = await seedMatrix(admin);
    const seen: Record<string, string[]> = {};
    for (const [id, ownHome] of Object.entries(people)) {
      const res = await ownHome();
      expect(res.status, id).toBe(200);
      const own = (await res.json()) as HomeBody;
      expect(own.signedIn, id).toBe(true);
      expect(await preview(admin, id), id).toEqual(own);
      seen[id] = ids(own);

      const links = await explain(admin, id);
      expect(links.map((l) => l.id), id).toEqual(["local-dev", "oidc-dev", "lower", "old", "checked", "g150", "orphan", "wiki", "members", "console"]);
      for (const row of links) expect(row.visible, `${id} ${row.id}`).toBe(row.reasons.length === 0);
      expect(links.filter((l) => l.visible).map((l) => l.id), id).toEqual(ids(own));
    }
    expect(seen).toEqual({
      lou: ["local-dev", "checked", "wiki", "members"],
      casey: ["lower", "wiki", "members"],
      many: ["g150", "wiki", "members"],
      nobody: ["wiki", "members"],
      olga: ["oidc-dev", "checked", "wiki", "members"],
      admin: ["wiki", "members"],
    });
    expect((await preview(admin, "lou")).pins).toEqual(["local-dev"]);
  });

  it("gives the empty state of the person, and signedIn true", async () => {
    const admin = await adminApp();
    await load(admin, [{ id: "ops", groups: ["local:Ops"], links: [{ id: "console", groups: ["local:Ops"] }] }]);
    await localUser(admin, "bob");
    expect(await preview(admin, "bob")).toEqual({ signedIn: true, categories: [], empty: "no_groups", pins: [] });
    expect(await preview(admin, "admin")).toEqual({ signedIn: true, categories: [], empty: "admin_no_access", pins: [] });
  });

  it("serves the preview of a disabled person and of one with a temporary password", async () => {
    const admin = await adminApp();
    await load(admin, [{ id: "tools", groups: ["@authenticated"], links: [{ id: "intranet", groups: ["@authenticated"] }] }]);
    await addUser(admin, { id: "dana", email: "dana@example.invalid" });
    await admin.exec(`update "user" set disabled = 1 where id = 'dana'`);
    expect(ids(await preview(admin, "dana"))).toEqual(["intranet"]);

    const tmp = admin.another();
    await addUser(tmp, { id: "tmp", email: "tmp@example.invalid", mustChangePassword: true });
    expect((await signIn(tmp, "tmp@example.invalid")).status).toBe(200);
    expect(ids(await preview(admin, "tmp"))).toEqual(["intranet"]);
    const own = await tmp.request("/api/home");
    expect(own.status).toBe(403);
    expect(((await own.json()) as { error: { code: string } }).error.code).toBe("password_change_required");
  });

  it("sends the public status of the person's checked links, never the reason nor a hidden link", async () => {
    const admin = await adminApp();
    await load(admin, [
      { id: "ops", groups: ["local:Ops"], links: [{ id: "grafana", groups: ["local:Ops"], check: true }, { id: "secretlinkgroup", groups: ["local:Dev"], check: true }] },
      { id: "dev", groups: ["local:Dev"], links: [{ id: "secretcatgroup", groups: ["local:Ops"], check: true }] },
    ]);
    // A whole second, so the ISO times in the body cannot contain the "502" looked for below.
    const at = Math.floor((Date.now() - MINUTE) / 1000) * 1000;
    await admin.batch(
      ["grafana", "secretlinkgroup", "secretcatgroup"].map(
        (id) =>
          `insert into link_status (link_id, source, state, reason, http_status, checked_at, due_at) values ('${id}', 'yasad', 'down', 'http_error', 502, ${at}, ${at + 60 * MINUTE})`,
      ),
    );
    await localUser(admin, "olga");
    await join(admin, "olga", "Ops");
    const res = await admin.request("/api/admin/access/users/olga/home");
    const text = await res.text();
    const body = JSON.parse(text) as HomeBody;
    expect(body.categories.flatMap((c) => c.links)).toEqual([expect.objectContaining({ id: "grafana", status: expect.objectContaining({ state: "down" }) })]);
    for (const marker of ["secretlinkgroup", "secretcatgroup", "http_error", "502"]) expect(text).not.toContain(marker);
  });
});

describe("GET /api/admin/access/visitor/home", () => {
  it("is the home page of a visitor who is not signed in", async () => {
    const admin = await adminApp();
    await load(admin, MATRIX);
    const anonymous = (await (await admin.another().request("/api/home")).json()) as HomeBody;
    const body = await getJson<HomeBody>(admin, "/api/admin/access/visitor/home");
    expect(body).toEqual(anonymous);
    expect(body).toEqual({ signedIn: false, categories: [{ id: "public", title: "Category public", links: [expect.objectContaining({ id: "wiki" })] }], empty: null, pins: [] });
  });

  it("is empty, with no empty state, when nothing is public", async () => {
    const admin = await adminApp();
    await load(admin, [{ id: "tools", groups: ["@authenticated"], links: [{ id: "intranet", groups: ["@authenticated"] }] }]);
    expect(await getJson<HomeBody>(admin, "/api/admin/access/visitor/home")).toEqual({ signedIn: false, categories: [], empty: null, pins: [] });
  });
});

describe("GET /api/admin/access/users/:id/links, reasons", () => {
  /** Load `categories` and return the reason codes of each link for a person in no group. */
  async function codesFor(categories: CategorySpec[]): Promise<Record<string, string[]>> {
    const admin = await adminApp();
    await load(admin, categories);
    await localUser(admin, "bob");
    return Object.fromEntries((await explain(admin, "bob")).map((row) => [row.id, row.reasons.map((r) => r.code)]));
  }

  it("names each reason on a minimal case", async () => {
    expect(
      await codesFor([
        {
          id: "open",
          groups: ["@authenticated"],
          links: [
            { id: "visible", groups: ["@authenticated"] },
            { id: "inactive", groups: ["@authenticated"], active: false },
            { id: "no-group", groups: [] },
            { id: "missing-link", groups: ["local:Ops"] },
          ],
        },
        { id: "closed", groups: [], links: [{ id: "no-category-group", groups: ["@authenticated"] }] },
        { id: "ops", groups: ["local:Ops"], links: [{ id: "missing-category", groups: ["@authenticated"] }] },
      ]),
    ).toEqual({
      visible: [],
      inactive: ["link_inactive"],
      "no-group": ["link_no_group"],
      "missing-link": ["missing_link_group"],
      "no-category-group": ["category_no_group"],
      "missing-category": ["missing_category_group"],
    });
  });

  it("lists every reason, in fixing order, an inactive link included", async () => {
    expect(
      await codesFor([
        {
          id: "closed",
          groups: [],
          links: [
            { id: "nothing", groups: [], active: false },
            { id: "missing", groups: ["local:Ops"], active: false },
          ],
        },
        { id: "ops", groups: ["local:Ops"], links: [{ id: "both", groups: ["local:Ops"], active: false }] },
      ]),
    ).toEqual({
      nothing: ["link_inactive", "link_no_group", "category_no_group"],
      missing: ["link_inactive", "category_no_group", "missing_link_group"],
      both: ["link_inactive", "missing_link_group", "missing_category_group"],
    });
  });

  it("explains one link with ?as=, as the list does", async () => {
    const admin = await adminApp();
    await load(admin, [{ id: "ops", groups: ["local:Ops"], links: [{ id: "console", groups: ["local:Ops"] }, { id: "wiki", groups: ["@everyone"] }] }]);
    await localUser(admin, "bob");
    const row = await explainOne(admin, "bob", "console");
    expect(row).toEqual({
      id: "console",
      title: "Link console",
      categoryId: "ops",
      categoryTitle: "Category ops",
      visible: false,
      reasons: [{ code: "missing_link_group" }, { code: "missing_category_group" }],
    });
    expect((await explain(admin, "bob"))[0]).toEqual(row);
  });

  it("says when the person pinned a link they no longer see", async () => {
    const admin = await adminApp();
    await load(admin, [{ id: "ops", groups: ["local:Ops"], links: [{ id: "console", groups: ["local:Ops"] }, { id: "wiki", groups: ["local:Ops"] }] }]);
    const bob = await localUser(admin, "bob");
    await join(admin, "bob", "Ops");
    expect((await post(bob, "/api/pins", { linkId: "console" })).status).toBe(200);
    expect((await send(admin, "DELETE", `/api/admin/groups/${await groupId(admin, "local", "Ops")}/members/bob`)).status).toBe(204);
    const [pinned, other] = await explain(admin, "bob");
    expect(pinned).toMatchObject({ id: "console", visible: false, pinned: true });
    expect(other).not.toHaveProperty("pinned");
  });
});

describe("GET /api/admin/access/users/:id/links, hints", () => {
  async function seedHints(admin: TestApp) {
    await load(admin, [
      { id: "tools", groups: ["@authenticated"], links: [{ id: "dev", groups: ["local:Dev"] }, { id: "named-everyone", groups: ["local:everyone"] }] },
      { id: "by-cat", groups: ["local:Dev"], links: [{ id: "in-dev", groups: ["@authenticated"] }] },
    ]);
  }
  const group = async (admin: TestApp, source: string, name: string) => ({ id: await groupId(admin, source, name), name, source });

  it("names a held group of the same name from another source", async () => {
    const admin = await adminApp();
    await seedHints(admin);
    await oidcPerson(admin, "olga");
    await admin.exec(`insert into "group" (id, name, source) values ('oidc-dev', 'Dev', 'oidc')`);
    await addMembership(admin, "olga", "oidc", "Dev");
    const hint = { kind: "other_source", held: await group(admin, "oidc", "Dev"), expected: await group(admin, "local", "Dev") };
    const rows = Object.fromEntries((await explain(admin, "olga")).map((row) => [row.id, row]));
    expect(rows.dev!.reasons).toEqual([{ code: "missing_link_group", hint }]);
    expect(rows["in-dev"]!.reasons).toEqual([{ code: "missing_category_group", hint }]);
    expect(rows.dev!.visible).toBe(false);
    // The link page reads the groups of one link and one category only: it must give the same hints.
    expect(await explainOne(admin, "olga", "dev")).toEqual(rows.dev);
    expect(await explainOne(admin, "olga", "in-dev")).toEqual(rows["in-dev"]);
  });

  it("names a held group whose name differs only by case", async () => {
    const admin = await adminApp();
    await seedHints(admin);
    await admin.exec(`insert into "group" (id, name, source) values ('local-dev-lower', 'dev', 'local')`);
    await localUser(admin, "casey");
    await join(admin, "casey", "dev");
    const [dev] = await explain(admin, "casey");
    expect(dev!.reasons).toEqual([
      { code: "missing_link_group", hint: { kind: "other_case", held: await group(admin, "local", "dev"), expected: await group(admin, "local", "Dev") } },
    ]);
  });

  it("prefers a group from another source to one differing by case", async () => {
    const admin = await adminApp();
    await seedHints(admin);
    await admin.exec(`insert into "group" (id, name, source) values ('oidc-dev', 'Dev', 'oidc'), ('local-dev-lower', 'dev', 'local')`);
    await localUser(admin, "mixed");
    await addMembership(admin, "mixed", "oidc", "Dev");
    await addMembership(admin, "mixed", "local", "dev");
    const [dev] = await explain(admin, "mixed");
    expect(dev!.reasons).toEqual([
      { code: "missing_link_group", hint: { kind: "other_source", held: await group(admin, "oidc", "Dev"), expected: await group(admin, "local", "Dev") } },
    ]);
  });

  it("gives no hint when the group is really missing, nor from a system group", async () => {
    const admin = await adminApp();
    await seedHints(admin);
    await localUser(admin, "bob");
    const rows = Object.fromEntries((await explain(admin, "bob")).map((row) => [row.id, row.reasons]));
    // Bob holds @everyone, a system group: it never stands for local:everyone.
    expect(rows["named-everyone"]).toEqual([{ code: "missing_link_group" }]);
    expect(rows.dev).toEqual([{ code: "missing_link_group" }]);
  });
});

describe("GET /api/admin/access/links/:id and categories/:id, audience", () => {
  it("counts active accounts by the rule, admins included, disabled ones left out", async () => {
    const admin = await adminApp();
    await load(admin, [{ id: "dev", groups: ["local:Dev"], links: [{ id: "repo", groups: ["local:Dev"] }, { id: "other", groups: ["local:Ops"] }] }]);
    await localUser(admin, "lou");
    await addUser(admin, { id: "dana", email: "dana@example.invalid" });
    await addUser(admin, { id: "tmp", email: "tmp@example.invalid", mustChangePassword: true });
    await addUser(admin, { id: "out", email: "out@example.invalid" });
    for (const id of ["lou", "dana", "tmp", "admin"]) await join(admin, id, "Dev");
    await admin.exec(`update "user" set disabled = 1 where id = 'dana'`);
    expect(await linkAudience(admin, "repo")).toEqual({ people: 3, public: false });
    expect(await linkAudience(admin, "other")).toEqual({ people: 0, public: false });
    expect(await categoryAudience(admin, "dev")).toEqual({ people: 3, public: false });
  });

  it("counts a person in two groups of the link once, and a category by the people who see one of its links", async () => {
    const admin = await adminApp();
    await load(admin, [
      { id: "tools", groups: ["@authenticated"], links: [{ id: "either", groups: ["local:A", "local:B"] }, { id: "only-a", groups: ["local:A"] }, { id: "only-b", groups: ["local:B"] }] },
    ]);
    for (const [id, groups] of [["alice", ["A"]], ["bob", ["B"]], ["carol", ["A", "B"]]] as const) {
      await addUser(admin, { id, email: `${id}@example.invalid` });
      for (const name of groups) await join(admin, id, name);
    }
    expect(await linkAudience(admin, "either")).toEqual({ people: 3, public: false });
    expect(await linkAudience(admin, "only-a")).toEqual({ people: 2, public: false });
    expect(await categoryAudience(admin, "tools")).toEqual({ people: 3, public: false });
  });

  it("says when a visitor who is not signed in sees it", async () => {
    const admin = await adminApp();
    await load(admin, [
      { id: "public", groups: ["@everyone"], links: [{ id: "wiki", groups: ["@everyone"] }, { id: "members", groups: ["@authenticated"] }] },
      { id: "private", groups: ["@authenticated"], links: [{ id: "hr", groups: ["@everyone"] }] },
    ]);
    await addUser(admin, { id: "bob", email: "bob@example.invalid" });
    expect(await linkAudience(admin, "wiki")).toEqual({ people: 2, public: true });
    expect(await linkAudience(admin, "members")).toEqual({ people: 2, public: false });
    expect(await linkAudience(admin, "hr")).toEqual({ people: 2, public: false });
    expect(await categoryAudience(admin, "public")).toEqual({ people: 2, public: true });
    expect(await categoryAudience(admin, "private")).toEqual({ people: 2, public: false });
  });

  it("counts nobody for a category whose links are all inactive", async () => {
    const admin = await adminApp();
    await load(admin, [{ id: "retired", groups: ["@everyone"], links: [{ id: "gone", groups: ["@everyone"], active: false }] }]);
    expect(await categoryAudience(admin, "retired")).toEqual({ people: 0, public: false });
    expect(await linkAudience(admin, "gone")).toEqual({ people: 0, public: false });
  });

  it("counts a person in more groups than D1's 100 bound parameters", async () => {
    const admin = await adminApp();
    const values = Array.from({ length: 150 }, (_, i) => `('g-${i + 1}', 'G${i + 1}', 'local')`).join(", ");
    await admin.exec(`insert into "group" (id, name, source) values ${values}`);
    await addUser(admin, { id: "many", email: "many@example.invalid" });
    await admin.exec(`insert into user_group (user_id, group_id) select 'many', id from "group" where id like 'g-%'`);
    await load(admin, [{ id: "tools", groups: ["local:G150"], links: [{ id: "last", groups: ["local:G150"] }] }]);
    expect(await linkAudience(admin, "last")).toEqual({ people: 1, public: false });
    expect(await categoryAudience(admin, "tools")).toEqual({ people: 1, public: false });
  });

  it("returns the audience with the explanation for ?as=", async () => {
    const admin = await adminApp();
    await load(admin, [{ id: "tools", groups: ["@authenticated"], links: [{ id: "intranet", groups: ["@authenticated"] }] }]);
    await addUser(admin, { id: "bob", email: "bob@example.invalid" });
    expect(await getJson(admin, "/api/admin/access/links/intranet?as=bob")).toEqual({
      audience: { people: 2, public: false },
      explanation: { id: "intranet", title: "Link intranet", categoryId: "tools", categoryTitle: "Category tools", visible: true, reasons: [] },
    });
  });
});

describe("/api/admin/access, security", () => {
  const ROUTES = [
    "/api/admin/access/users/bob/home",
    "/api/admin/access/users/bob/links",
    "/api/admin/access/links/intranet",
    "/api/admin/access/links/intranet?as=bob",
    "/api/admin/access/categories/tools",
    "/api/admin/access/visitor/home",
  ];

  async function seed(): Promise<{ admin: TestApp; bob: TestApp }> {
    const admin = await adminApp();
    await load(admin, [
      { id: "tools", groups: ["@authenticated"], links: [{ id: "intranet", groups: ["@authenticated"] }] },
      { id: "ops", groups: ["local:Ops"], links: [{ id: "console", groups: ["local:Ops"] }] },
    ]);
    const bob = await localUser(admin, "bob");
    await join(admin, "bob", "Ops");
    return { admin, bob };
  }

  const codeOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

  it("refuses visitors, people who are not admins, and an admin with a temporary password", async () => {
    const { admin, bob } = await seed();
    const tmp = admin.another();
    await addUser(tmp, { id: "tmpadmin", email: "tmpadmin@example.invalid", role: "admin", mustChangePassword: true });
    expect((await signIn(tmp, "tmpadmin@example.invalid")).status).toBe(200);
    for (const path of ROUTES) {
      const anonymous = await admin.another().request(path);
      expect(anonymous.status, path).toBe(401);
      expect(anonymous.headers.get("cache-control"), path).toBe("no-store");
      expect(await codeOf(anonymous)).toBe("unauthenticated");
      const user = await bob.request(path);
      expect(user.status, path).toBe(403);
      expect(user.headers.get("cache-control"), path).toBe("no-store");
      expect(await codeOf(user)).toBe("forbidden");
      const temporary = await tmp.request(path);
      expect(temporary.status, path).toBe(403);
      expect(await codeOf(temporary)).toBe("password_change_required");
    }
  });

  it("answers only GET", async () => {
    const { admin } = await seed();
    for (const path of ROUTES) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) expect((await send(admin, method, path, {})).status, `${method} ${path}`).toBe(404);
    }
  });

  it("writes nothing, sets no cookie, leaves the person's session alone, and is never cached", async () => {
    const { admin, bob } = await seed();
    const counts = async () => admin.query(`select (select count(*) from session) as sessions, (select count(*) from audit_log) as entries`);
    const before = await counts();
    const adminHome = await (await admin.request("/api/home")).json();
    for (const path of ROUTES) {
      const res = await admin.request(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.getSetCookie(), path).toEqual([]);
      expect(res.headers.get("cache-control"), path).toBe("no-store");
    }
    expect(await counts()).toEqual(before);
    const own = (await (await bob.request("/api/home")).json()) as HomeBody;
    expect(own.signedIn).toBe(true);
    expect(ids(own)).toEqual(["intranet", "console"]);
    // The admin gains nothing from having looked: their home is unchanged, and a link of Bob's stays closed to them.
    expect(await (await admin.request("/api/home")).json()).toEqual(adminHome);
    expect((await post(admin, "/api/pins", { linkId: "console" })).status).toBe(404);
  });

  it("answers 404 for an unknown person, link or category", async () => {
    const { admin } = await seed();
    for (const path of [
      "/api/admin/access/users/nobody/home",
      "/api/admin/access/users/nobody/links",
      "/api/admin/access/links/nothing",
      "/api/admin/access/links/nothing?as=bob",
      "/api/admin/access/links/intranet?as=nobody",
      "/api/admin/access/links/intranet?as=",
      "/api/admin/access/categories/nothing",
    ]) {
      const res = await admin.request(path);
      expect(res.status, path).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
      expect(res.headers.get("cache-control"), path).toBe("no-store");
    }
  });
});
