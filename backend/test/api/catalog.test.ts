import { type TestApp, testApp } from "#harness";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { addUser, post, signIn } from "./users";

const CATALOG = `version: 1
categories:
  - id: dev-tools
    title: Developer tools
    groups: ["@authenticated"]
    links:
      - id: jira
        title: Jira
        url: https://acme.atlassian.net
        description: Tickets and sprints
        icon: si:jira
        keywords: [tickets, issues]
        groups: ["oidc:Developers", "local:Contractors"]
      - id: grafana
        title: Grafana
        url: https://grafana.example.org
        groups: ["oidc:Developers"]
        active: false
  - id: everyday
    title: Everyday
    groups: ["@everyone"]
    links:
      - id: mail
        title: Mail
        url: https://mail.example.org
        icon: lucide:mail
        groups: ["@everyone"]
`;

type Diff = {
  added: { categories: string[]; links: string[] };
  updated: { categories: string[]; links: string[] };
  removed: { categories: string[]; links: string[] };
  groupsCreated: string[];
  warnings: Record<string, unknown>[];
  labels: { categories: Record<string, string>; links: Record<string, { title: string; categoryId: string }> };
};
type ImportBody = {
  applied: boolean;
  diff: Diff;
  baseVersion: string;
  error?: { code: string; errors?: { path: string; code: string; params: Record<string, unknown> }[] };
};

async function adminApp(env = {}): Promise<TestApp> {
  const app = await testApp(env);
  await addUser(app, { id: "admin", email: "ada@example.invalid", role: "admin" });
  expect((await signIn(app, "ada@example.invalid")).status).toBe(200);
  return app;
}

async function send(app: TestApp, yaml: string, dryRun: boolean, baseVersion?: string) {
  const res = await post(app, "/api/admin/catalog", { yaml, dryRun, baseVersion });
  return { status: res.status, body: (await res.json()) as ImportBody };
}

/** Preview then apply, as the admin page does. */
async function importFile(app: TestApp, yaml: string) {
  const preview = await send(app, yaml, true);
  expect(preview.status).toBe(200);
  return send(app, yaml, false, preview.body.baseVersion);
}


describe("catalog import and export", () => {
  it("previews without writing, then applies", async () => {
    const app = await adminApp();
    const preview = await send(app, CATALOG, true);
    expect(preview.body.applied).toBe(false);
    expect(preview.body.diff.added).toEqual({ categories: ["dev-tools", "everyday"], links: ["jira", "grafana", "mail"] });
    expect(preview.body.diff.groupsCreated).toEqual(["local:Contractors", "oidc:Developers"]);
    expect(await app.query("select id from link")).toEqual([]);

    const applied = await send(app, CATALOG, false, preview.body.baseVersion);
    expect(applied.body.applied).toBe(true);
    expect(await app.query("select id from link order by id")).toEqual([{ id: "grafana" }, { id: "jira" }, { id: "mail" }]);
    // Only a sign-in tells that the provider sends a group.
    expect(await app.query(`select name, seen_at from "group" where source <> 'system' order by name`)).toEqual([
      { name: "Contractors", seen_at: null },
      { name: "Developers", seen_at: null },
    ]);
  });

  it("exports the same catalog, and re-importing it changes nothing", async () => {
    const app = await adminApp();
    await importFile(app, CATALOG);
    const res = await app.request("/api/admin/catalog");
    expect(res.headers.get("content-disposition")).toContain("catalog.yaml");
    const exported = await res.text();
    const sortGroups = (file: string) => {
      const catalog = parse(file) as { categories: { groups: string[]; links: { groups: string[] }[] }[] };
      for (const cat of catalog.categories) {
        cat.groups.sort();
        for (const lnk of cat.links) lnk.groups.sort();
      }
      return catalog;
    };
    expect(sortGroups(exported)).toEqual(sortGroups(CATALOG));
    const again = await send(app, exported, true);
    expect(again.body.diff.added).toEqual({ categories: [], links: [] });
    expect(again.body.diff.updated).toEqual({ categories: [], links: [] });
    expect(again.body.diff.removed).toEqual({ categories: [], links: [] });
    expect((await send(app, CATALOG, true)).body.diff.updated).toEqual({ categories: [], links: [] });
  });

  it("exports a link whose stored keywords are malformed without them, instead of failing", async () => {
    const app = await adminApp();
    await importFile(app, CATALOG);
    await app.exec(`update link set keywords = 'not json' where id = 'jira'`);
    const res = await app.request("/api/admin/catalog");
    expect(res.status).toBe(200);
    const exported = parse(await res.text()) as { categories: { links: { id: string; keywords?: string[] }[] }[] };
    expect(exported.categories[0]!.links.find((l) => l.id === "jira")?.keywords).toBeUndefined();
  });

  it("removes what the file no longer has, but keeps groups", async () => {
    const app = await adminApp();
    await importFile(app, CATALOG);
    const onlyJira = CATALOG.slice(0, CATALOG.indexOf("      - id: grafana"));
    const result = await importFile(app, onlyJira);
    expect(result.body.diff.removed).toEqual({ categories: ["everyday"], links: ["grafana", "mail"] });
    expect(await app.query("select id from link")).toEqual([{ id: "jira" }]);
    expect(await app.query("select id from category")).toEqual([{ id: "dev-tools" }]);
    expect(await app.query(`select name from "group" where source = 'oidc'`)).toEqual([{ name: "Developers" }]);
  });

  it("moves a link between categories as an update", async () => {
    const app = await adminApp();
    await importFile(app, CATALOG);
    const moved = CATALOG.replace("      - id: mail\n        title: Mail\n        url: https://mail.example.org\n        icon: lucide:mail\n        groups: [\"@everyone\"]\n", "").replace(
      "  - id: everyday",
      "      - id: mail\n        title: Mail\n        url: https://mail.example.org\n        icon: lucide:mail\n        groups: [\"@everyone\"]\n  - id: everyday",
    );
    const result = await importFile(app, moved);
    expect(result.body.diff.updated.links).toEqual(["mail"]);
    expect(result.body.diff.removed.links).toEqual([]);
    expect(await app.query("select category_id from link where id = 'mail'")).toEqual([{ category_id: "dev-tools" }]);
  });

  it("labels each change with its title from the file, and each removal with its stored title and category", async () => {
    const app = await adminApp();
    await importFile(app, CATALOG);
    const next = `version: 1
categories:
  - id: dev-tools
    title: Dev tools
    groups: ["@authenticated"]
    links:
      - id: jira
        title: Jira Cloud
        url: https://acme.atlassian.net
        description: Tickets and sprints
        icon: si:jira
        keywords: [tickets, issues]
        groups: ["oidc:Developers", "local:Contractors"]
  - id: ops
    title: Operations
    groups: ["@authenticated"]
    links:
      - id: grafana
        title: Grafana
        url: https://grafana.example.org
        groups: ["oidc:Developers"]
        active: false
      - id: status
        title: Status page
        url: https://status.example.org
        groups: ["@everyone"]
`;
    const { diff } = (await send(app, next, true)).body;
    expect(diff.added).toEqual({ categories: ["ops"], links: ["status"] });
    expect(diff.updated).toEqual({ categories: ["dev-tools"], links: ["jira", "grafana"] });
    expect(diff.removed).toEqual({ categories: ["everyday"], links: ["mail"] });
    expect(diff.labels).toEqual({
      categories: { ops: "Operations", "dev-tools": "Dev tools", everyday: "Everyday" },
      links: {
        status: { title: "Status page", categoryId: "ops" },
        jira: { title: "Jira Cloud", categoryId: "dev-tools" },
        grafana: { title: "Grafana", categoryId: "ops" },
        mail: { title: "Mail", categoryId: "everyday" },
      },
    });
  });

  it("labels the category holding each listed link, and a listed category with its own title", async () => {
    const app = await adminApp();
    await importFile(app, CATALOG);
    const next = `version: 1
categories:
  - id: dev-tools
    title: Developer tools
    groups: ["@authenticated"]
    links:
      - id: jira
        title: Jira Cloud
        url: https://acme.atlassian.net
        description: Tickets and sprints
        icon: si:jira
        keywords: [tickets, issues]
        groups: ["oidc:Developers", "local:Contractors"]
  - id: everyday
    title: Daily
    groups: ["@everyone"]
    links: []
`;
    const { diff } = (await send(app, next, true)).body;
    expect(diff.updated).toEqual({ categories: ["everyday"], links: ["jira"] });
    expect(diff.removed).toEqual({ categories: [], links: ["grafana", "mail"] });
    // dev-tools is unchanged; everyday holds a removed link but is renamed, so it keeps the title from the file.
    expect(diff.labels.categories).toEqual({ "dev-tools": "Developer tools", everyday: "Daily" });
    expect(diff.labels.links).toEqual({
      jira: { title: "Jira Cloud", categoryId: "dev-tools" },
      grafana: { title: "Grafana", categoryId: "dev-tools" },
      mail: { title: "Mail", categoryId: "everyday" },
    });
  });

  it("labels the items a warning names, though the diff does not list them", async () => {
    const app = await adminApp();
    const quiet = `version: 1
categories:
  - id: tools
    title: Tools
    groups: []
    links:
      - id: wiki
        title: Wiki
        url: https://wiki.example.org
        icon: si:not-an-icon-at-all
        groups: ["@everyone"]
`;
    await importFile(app, quiet);
    const { diff } = (await send(app, quiet, true)).body;
    expect(diff.added).toEqual({ categories: [], links: [] });
    expect(diff.updated).toEqual({ categories: [], links: [] });
    expect(diff.warnings).toEqual([
      { code: "no_group", kind: "category", id: "tools" },
      { code: "unknown_icon", kind: "link", id: "wiki" },
    ]);
    expect(diff.labels).toEqual({ categories: { tools: "Tools" }, links: { wiki: { title: "Wiki", categoryId: "tools" } } });
  });

  it("labels an item whose id is also the name of an object property", async () => {
    const app = await adminApp();
    const file = `version: 1
categories:
  - id: constructor
    title: Builders
    groups: []
    links: []
  - id: tools
    title: Tools
    groups: ["@everyone"]
    links:
      - id: wiki
        title: Wiki
        url: https://wiki.example.org
        groups: ["@everyone"]
`;
    await importFile(app, file);
    // Only the warning names the unchanged "constructor" category.
    const { diff } = (await send(app, file.replace("title: Wiki", "title: Handbook"), true)).body;
    expect(diff.updated.links).toEqual(["wiki"]);
    expect(diff.warnings).toEqual([{ code: "no_group", kind: "category", id: "constructor" }]);
    expect(diff.labels.categories).toEqual({ tools: "Tools", constructor: "Builders" });
  });

  it("refuses an invalid file and writes nothing", async () => {
    const app = await adminApp();
    await importFile(app, CATALOG);
    const broken = CATALOG.replace("https://mail.example.org", "javascript:alert(1)").replace("    groups: [\"@everyone\"]\n    links:", "    gropus: []\n    links:");
    const res = await send(app, broken, false, "whatever");
    expect(res.status).toBe(422);
    expect(res.body.error!.code).toBe("invalid_catalog");
    const paths = res.body.error!.errors!.map((e) => e.path);
    expect(paths).toContain("categories[1].links[0].url");
    expect(paths).toContain("categories[1]");
    expect(await app.query("select url from link where id = 'mail'")).toEqual([{ url: "https://mail.example.org" }]);
  });

  it("refuses duplicate ids, anchors and aliases", async () => {
    const app = await adminApp();
    const duplicate = CATALOG.replace("id: grafana", "id: jira");
    expect((await send(app, duplicate, true)).body.error!.errors).toEqual([{ path: "categories[0].links[1].id", code: "duplicate_id", params: { id: "jira" } }]);
    const bomb = `version: 1\ncategories:\n  - &a {id: x, title: X, groups: [], links: []}\n  - *a\n`;
    expect((await send(app, bomb, true)).body.error!.errors).toEqual([{ path: "", code: "anchors_not_allowed", params: {} }]);
  });

  it("reports each problem as a code the interface translates", async () => {
    const app = await adminApp();
    const broken = CATALOG.replace("id: dev-tools", "id: Dev Tools")
      .replace('"local:Contractors"', '"Contractors"')
      .replace("icon: si:jira", "icon: jira")
      .replace("title: Grafana", "title: ''\n        colour: red");
    const codes = (await send(app, broken, true)).body.error!.errors!.map(({ path, code }) => ({ path, code }));
    expect(codes).toEqual(
      expect.arrayContaining([
        { path: "categories[0].id", code: "invalid_id" },
        { path: "categories[0].links[0].groups[1]", code: "invalid_group_ref" },
        { path: "categories[0].links[0].icon", code: "invalid_icon" },
        { path: "categories[0].links[1].title", code: "required" },
        { path: "categories[0].links[1]", code: "unknown_field" },
      ]),
    );
    const syntax = (await send(app, "version: 1\ncategories: [", true)).body.error!.errors!;
    expect(syntax[0]).toMatchObject({ path: "", code: "yaml_syntax" });
  });

  it("refuses a key written twice in the same table", async () => {
    const app = await adminApp();
    const twice = CATALOG.replace("title: Grafana", "title: Grafana\n        title: Grafana 2");
    expect((await send(app, twice, true)).body.error!.errors).toEqual([{ path: "categories[0].links[1]", code: "duplicate_key", params: { key: "title" } }]);
  });

  it("answers quickly for a file with a huge table", async () => {
    const app = await adminApp();
    const keys = Array.from({ length: 90_000 }, (_, i) => `${i.toString(36)}: 1`).join(", ");
    const file = `version: 1\ncategories:\n  - id: x\n    title: X\n    groups: []\n    extra: {${keys}}\n`;
    expect(file.length).toBeLessThan(1024 * 1024);
    const started = Date.now();
    const res = await send(app, file, true);
    expect(res.status).toBe(422);
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 15_000);

  it("accepts a group listed twice", async () => {
    const app = await adminApp();
    const twice = CATALOG.replace('groups: ["@authenticated"]', 'groups: ["@authenticated", "@authenticated"]').replace(
      'groups: ["oidc:Developers"]\n',
      'groups: ["oidc:Developers", "oidc:Developers"]\n',
    );
    expect((await importFile(app, twice)).status).toBe(200);
    expect(await app.query("select count(*) as n from link_group where link_id = 'grafana'")).toEqual([{ n: 1 }]);
  });

  it("refuses to apply over a catalog changed since the preview", async () => {
    const app = await adminApp();
    const preview = await send(app, CATALOG, true);
    await importFile(app, CATALOG.replace("title: Mail", "title: Webmail"));
    const res = await send(app, CATALOG, false, preview.body.baseVersion);
    expect(res.status).toBe(409);
    expect(res.body.error!.code).toBe("catalog_changed");
  });

  it("warns about items nobody can see and groups that differ only by case", async () => {
    const app = await adminApp();
    const file = CATALOG.replace('groups: ["oidc:Developers"]\n        active: false', 'groups: []').replace('"local:Contractors"', '"oidc:developers"');
    const { warnings } = (await send(app, file, true)).body.diff;
    expect(warnings).toContainEqual({ code: "no_group", kind: "link", id: "grafana" });
    expect(warnings).toContainEqual({ code: "groups_differ_by_case", groups: ["oidc:Developers", "oidc:developers"] });
  });

  it("warns about unknown icons and keeps them as written", async () => {
    const app = await adminApp();
    const file = CATALOG.replace("icon: si:jira", "icon: si:backstage_casting").replace("icon: lucide:mail", "icon: lucide:no-such-icon");
    const { warnings } = (await send(app, file, true)).body.diff;
    expect(warnings.filter((w) => w.code === "unknown_icon")).toEqual([{ code: "unknown_icon", kind: "link", id: "mail" }]);

    const excluded = file.replace("icon: si:backstage_casting", "icon: si:cocoapods");
    expect((await send(app, excluded, true)).body.diff.warnings.filter((w) => w.code === "unknown_icon")).toEqual([
      { code: "unknown_icon", kind: "link", id: "jira" },
      { code: "unknown_icon", kind: "link", id: "mail" },
    ]);
    expect((await importFile(app, excluded)).status).toBe(200);
    const exported = parse(await (await app.request("/api/admin/catalog")).text()) as { categories: { links: { icon?: string }[] }[] };
    expect(exported.categories.flatMap((c) => c.links.map((l) => l.icon))).toEqual(["si:cocoapods", undefined, "lucide:no-such-icon"]);
    expect((await send(app, CATALOG, true)).body.diff.warnings.filter((w) => w.code === "unknown_icon")).toEqual([]);
  });

  it("warns about a hyphenated Simple Icons slug instead of refusing it", async () => {
    const app = await adminApp();
    const file = CATALOG.replace("icon: si:jira", "icon: si:google-drive");
    const { warnings } = (await send(app, file, true)).body.diff;
    expect(warnings.filter((w) => w.code === "unknown_icon")).toEqual([{ code: "unknown_icon", kind: "link", id: "jira" }]);
    expect((await importFile(app, file)).status).toBe(200);
  });

  it("is refused to non-admins and without a session", async () => {
    const anonymous = await testApp();
    expect((await anonymous.request("/api/admin/catalog")).status).toBe(401);
    await addUser(anonymous, { id: "bob", email: "bob@example.invalid" });
    await signIn(anonymous, "bob@example.invalid");
    expect((await anonymous.request("/api/admin/catalog")).status).toBe(403);
    expect((await post(anonymous, "/api/admin/catalog", { yaml: CATALOG, dryRun: true })).status).toBe(403);
  });

  it("is read-only while CATALOG_FILE manages the catalog", async () => {
    const app = await adminApp({ CATALOG_FILE: "/config/catalog.yaml" });
    const res = await post(app, "/api/admin/catalog", { yaml: CATALOG, dryRun: true });
    expect(res.status).toBe(409);
    expect((await app.request("/api/admin/catalog")).status).toBe(200);
  });

  it("reports the catalog state to admins only", async () => {
    const app = await testApp();
    const codeOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
    expect((await app.request("/api/admin/catalog/state")).status).toBe(401);
    await addUser(app, { id: "bob", email: "bob@example.invalid" });
    await signIn(app, "bob@example.invalid");
    const user = await app.request("/api/admin/catalog/state");
    expect(user.status).toBe(403);
    expect(await codeOf(user)).toBe("forbidden");

    const temporary = app.another();
    await addUser(temporary, { id: "tmp", email: "tmp@example.invalid", role: "admin", mustChangePassword: true });
    expect((await signIn(temporary, "tmp@example.invalid")).status).toBe(200);
    const blocked = await temporary.request("/api/admin/catalog/state");
    expect(blocked.status).toBe(403);
    expect(await codeOf(blocked)).toBe("password_change_required");
  });

  it("counts stored categories and links, and each group they use once", async () => {
    const app = await adminApp();
    const empty = await app.request("/api/admin/catalog/state");
    expect(empty.headers.get("cache-control")).toBe("no-store");
    expect(await empty.json()).toMatchObject({ managedByFile: false, categories: 0, links: 0, groups: 0 });

    await importFile(app, CATALOG);
    // @everyone is on a category and a link; oidc:Developers is on two links.
    const res = await app.request("/api/admin/catalog/state");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ managedByFile: false, categories: 2, links: 3, groups: 4 });
  });

  it("reports a catalog managed by CATALOG_FILE", async () => {
    const app = await adminApp({ CATALOG_FILE: "/config/catalog.yaml" });
    const res = await app.request("/api/admin/catalog/state");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { managedByFile: boolean }).managedByFile).toBe(true);
  });

  it("accepts files up to 1 MB, and 500 links in one import", async () => {
    const app = await adminApp();
    const links = Array.from({ length: 500 }, (_, i) => `      - id: link-${i}\n        title: Link ${i}\n        url: https://example.org/${i}\n        groups: ["@everyone", "oidc:Team ${i % 10}"]\n`).join("");
    const big = `version: 1\ncategories:\n  - id: many\n    title: Many\n    groups: ["@everyone"]\n    links:\n${links}`;
    expect(big.length).toBeGreaterThan(16 * 1024);
    expect((await importFile(app, big)).status).toBe(200);
    expect(await app.query("select count(*) as n from link")).toEqual([{ n: 500 }]);
    const tooBig = (await post(app, "/api/admin/catalog", { yaml: "#".repeat(1024 * 1024 + 1), dryRun: true })).status;
    expect(tooBig).toBe(413);

    const fewer = big.slice(0, big.indexOf("      - id: link-40\n"));
    expect((await importFile(app, fewer)).body.diff.removed.links).toHaveLength(460);
    expect(await app.query("select count(*) as n from link")).toEqual([{ n: 40 }]);
  });
});
