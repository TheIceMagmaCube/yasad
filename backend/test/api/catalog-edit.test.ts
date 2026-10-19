import { type TestApp } from "#harness";
import { describe, expect, it } from "vitest";

import { adminApp, adminCatalog, type Category, errorOf, type Link, newCategory, newLink } from "./catalog-items";
import { addUser, post, send, signIn } from "./users";

const ROUTES: [string, string][] = [
  ["GET", "/api/admin/categories"],
  ["POST", "/api/admin/categories"],
  ["PATCH", "/api/admin/categories/tools"],
  ["POST", "/api/admin/categories/tools/move"],
  ["DELETE", "/api/admin/categories/tools"],
  ["POST", "/api/admin/links"],
  ["PATCH", "/api/admin/links/wiki"],
  ["POST", "/api/admin/links/wiki/move"],
  ["DELETE", "/api/admin/links/wiki"],
];
const WRITES = ROUTES.filter(([method]) => method !== "GET");

/** Return a second browser signed in as a new local user, member of the given local groups. */
async function member(admin: TestApp, id: string, groups: string[]): Promise<TestApp> {
  const browser = admin.another();
  await addUser(browser, { id, email: `${id}@example.invalid` });
  for (const name of groups) {
    await browser.exec(`insert into user_group (user_id, group_id) select '${id}', id from "group" where source = 'local' and name = '${name}'`);
  }
  expect((await signIn(browser, `${id}@example.invalid`)).status).toBe(200);
  return browser;
}

async function localGroup(app: TestApp, name: string) {
  expect((await post(app, "/api/admin/groups", { name })).status).toBe(201);
}

/** Return the ids and keywords of the home page, as the browser receives them. */
async function home(app: TestApp) {
  const res = await app.request("/api/home");
  const text = await res.text();
  const body = JSON.parse(text) as { categories: { id: string; links: { id: string }[] }[] };
  return { text, links: body.categories.flatMap((cat) => cat.links.map((lnk) => lnk.id)) };
}

async function linkOf(res: Response) {
  return (await res.json()) as { link: Link; warnings: string[] };
}

describe("catalog edits: access", () => {
  it("is refused without a session, to non-admins and with a temporary password", async () => {
    const admin = await adminApp();
    await newCategory(admin, { id: "tools", title: "Tools" });
    await newLink(admin, { id: "wiki", title: "Wiki", categoryId: "tools" });

    const anonymous = admin.another();
    for (const [method, path] of ROUTES) expect((await send(anonymous, method, path)).status, `${method} ${path}`).toBe(401);

    const user = admin.another();
    await addUser(user, { id: "bob", email: "bob@example.invalid" });
    await signIn(user, "bob@example.invalid");
    for (const [method, path] of ROUTES) {
      const res = await send(user, method, path, { revision: 1, title: "Hacked", direction: "up", linkCount: 1 });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect((await errorOf(res)).code).toBe("forbidden");
    }

    const temporary = admin.another();
    await addUser(temporary, { id: "eve", email: "eve@example.invalid", role: "admin", mustChangePassword: true });
    await signIn(temporary, "eve@example.invalid");
    for (const [method, path] of ROUTES) {
      const res = await send(temporary, method, path, { revision: 1, title: "Hacked", direction: "up", linkCount: 1 });
      expect((await errorOf(res)).code, `${method} ${path}`).toBe("password_change_required");
    }
    expect(await admin.query("select title from category")).toEqual([{ title: "Tools" }]);
    expect(await admin.query("select title from link")).toEqual([{ title: "Wiki" }]);
  });

  it("refuses a write without a JSON body", async () => {
    const admin = await adminApp();
    await newCategory(admin, { id: "tools", title: "Tools" });
    await newLink(admin, { id: "wiki", title: "Wiki", categoryId: "tools" });
    for (const [method, path] of WRITES) expect((await admin.request(path, { method })).status, `${method} ${path}`).toBe(415);
  });

  it("refuses every write while CATALOG_FILE manages the catalog, and still reads it", async () => {
    const admin = await adminApp({ CATALOG_FILE: "/config/catalog.yaml" });
    await admin.exec(`insert into category (id, title, position) values ('tools', 'Tools', 0)`);
    await admin.exec(`insert into link (id, category_id, title, url, position, active) values ('wiki', 'tools', 'Wiki', 'https://wiki.example.org', 0, 0)`);
    for (const [method, path] of WRITES) {
      const res = await send(admin, method, path, { revision: 1, title: "Changed", direction: "up", linkCount: 1 });
      expect(res.status, `${method} ${path}`).toBe(409);
      expect((await errorOf(res)).code).toBe("catalog_managed_by_file");
    }
    // Checked before the body: an invalid one gets the same answer.
    expect((await errorOf(await send(admin, "POST", "/api/admin/links", { nonsense: true }))).code).toBe("catalog_managed_by_file");
    const [tools] = await adminCatalog(admin);
    expect(tools).toMatchObject({ id: "tools", title: "Tools", links: [{ id: "wiki", active: false }] });
    expect(await admin.query("select title, revision from category")).toEqual([{ title: "Tools", revision: 1 }]);
  });

  it("applies the group rule to links made in the app, on the home page", async () => {
    const admin = await adminApp();
    await localGroup(admin, "A");
    await localGroup(admin, "B");
    await newCategory(admin, { id: "team", title: "Team", groups: ["local:B"] });
    const created = await newLink(admin, { id: "board", title: "Board", categoryId: "team", groups: ["local:A"], keywords: ["kw-board"] });

    const onlyA = await member(admin, "amy", ["A"]);
    const both = await member(admin, "ben", ["A", "B"]);
    const onlyB = await member(admin, "bea", ["B"]);
    expect((await home(onlyA)).links).toEqual([]);
    expect((await home(onlyB)).text).not.toContain("kw-board");
    expect((await home(both)).links).toEqual(["board"]);
    // Administrators follow the same rule on the home page.
    expect((await home(admin)).links).toEqual([]);

    // The home page follows a change of groups at the next request.
    const patched = await send(admin, "PATCH", "/api/admin/links/board", { revision: created.revision, groups: ["local:B"] });
    expect(patched.status).toBe(200);
    expect((await home(onlyB)).links).toEqual(["board"]);
    expect((await home(onlyA)).links).toEqual([]);
  });

  it("hides a deactivated link from everyone, keywords included, but keeps it on the admin screen", async () => {
    const admin = await adminApp();
    await newCategory(admin, { id: "tools", title: "Tools", groups: ["@everyone"] });
    const created = await newLink(admin, { id: "wiki", title: "Wiki", categoryId: "tools", keywords: ["kw-secret"] });
    expect((await home(admin.another())).links).toEqual(["wiki"]);

    const off = await linkOf(await send(admin, "PATCH", "/api/admin/links/wiki", { revision: created.revision, active: false }));
    expect(off.link).toMatchObject({ active: false, revision: created.revision + 1 });
    for (const viewer of [admin, admin.another()]) {
      const { text, links } = await home(viewer);
      expect(links).toEqual([]);
      expect(text).not.toContain("kw-secret");
    }
    const [tools] = await adminCatalog(admin);
    expect(tools!.links).toMatchObject([{ id: "wiki", active: false, keywords: ["kw-secret"] }]);

    expect((await send(admin, "PATCH", "/api/admin/links/wiki", { revision: off.link.revision, active: true })).status).toBe(200);
    expect((await home(admin.another())).links).toEqual(["wiki"]);
  });
});

describe("catalog edits: categories", () => {
  it("creates, reads and changes a category, with its groups", async () => {
    const admin = await adminApp();
    await localGroup(admin, "Office");
    const res = await post(admin, "/api/admin/categories", { id: "tools", title: "  Tools ", groups: ["local:Office", "@authenticated"] });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { category, warnings } = (await res.json()) as { category: Category; warnings: string[] };
    expect(category).toEqual({ id: "tools", title: "Tools", groups: ["@authenticated", "local:Office"], revision: 1, links: [] });
    expect(warnings).toEqual([]);

    const read = await admin.request("/api/admin/categories");
    expect(read.headers.get("cache-control")).toBe("no-store");
    expect(((await read.json()) as { categories: Category[] }).categories).toEqual([category]);

    const patched = await send(admin, "PATCH", "/api/admin/categories/tools", { revision: 1, title: "Daily tools" });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { category: Category }).category).toMatchObject({ title: "Daily tools", groups: ["@authenticated", "local:Office"], revision: 2 });
    const regrouped = await send(admin, "PATCH", "/api/admin/categories/tools", { revision: 2, groups: [] });
    expect(await regrouped.json()).toMatchObject({ category: { title: "Daily tools", groups: [], revision: 3 }, warnings: ["no_group"] });
  });

  it("derives a free id from the title when none is given", async () => {
    const admin = await adminApp();
    expect((await newCategory(admin, { title: "Équipe Prod & Ops!" })).id).toBe("equipe-prod-ops");
    expect((await newCategory(admin, { title: "Équipe prod ops" })).id).toBe("equipe-prod-ops-2");
    expect((await newCategory(admin, { title: "EQUIPE PROD OPS" })).id).toBe("equipe-prod-ops-3");
    expect((await newCategory(admin, { title: "!!!" })).id).toBe("categorie");
    expect((await newCategory(admin, { title: "x".repeat(70) })).id).toBe("x".repeat(64));
    expect((await newCategory(admin, { title: "x".repeat(70) })).id).toBe(`${"x".repeat(62)}-2`);
  });

  it("refuses invalid fields with a code per field", async () => {
    const admin = await adminApp();
    await newCategory(admin, { id: "tools", title: "Tools" });
    const fieldsOf = async (method: string, path: string, body: unknown) => {
      const res = await send(admin, method, path, body);
      expect(res.status).toBe(422);
      const error = await errorOf(res);
      expect(error.code).toBe("invalid_input");
      return error.fields;
    };
    expect(await fieldsOf("POST", "/api/admin/categories", {})).toEqual({ title: "required", groups: "required" });
    expect(await fieldsOf("POST", "/api/admin/categories", { id: "tools", title: "Again", groups: [] })).toEqual({ id: "id_taken" });
    expect(await fieldsOf("POST", "/api/admin/categories", { id: "Not Valid", title: "x".repeat(101), groups: ["Office"] })).toEqual({
      id: "invalid_id",
      title: "too_long",
      groups: "invalid_group_ref",
    });
    expect(await fieldsOf("POST", "/api/admin/categories", { title: "T", groups: Array.from({ length: 51 }, (_, i) => `oidc:g${i}`) })).toEqual({
      groups: "too_long",
    });
    expect(await fieldsOf("POST", "/api/admin/categories", { title: "T", groups: ["local:Nobody"] })).toEqual({ groups: "unknown_group" });
    expect(await fieldsOf("POST", "/api/admin/categories", { title: "T", groups: [], links: [], position: 0 })).toEqual({
      links: "unknown_field",
      position: "unknown_field",
    });
    expect(await fieldsOf("PATCH", "/api/admin/categories/tools", { title: "New" })).toEqual({ revision: "required" });
    expect(await fieldsOf("PATCH", "/api/admin/categories/tools", { revision: "1", id: "other" })).toEqual({ revision: "invalid", id: "unknown_field" });
    expect(await fieldsOf("POST", "/api/admin/categories/tools/move", { direction: "left" })).toEqual({ direction: "invalid" });
    expect(await fieldsOf("DELETE", "/api/admin/categories/tools", { revision: 1 })).toEqual({ linkCount: "required" });
    expect(await adminCatalog(admin)).toMatchObject([{ id: "tools", title: "Tools", revision: 1 }]);
  });

  it("answers 404 for a category that does not exist", async () => {
    const admin = await adminApp();
    for (const [method, path] of WRITES.filter(([, path]) => path.includes("/categories/"))) {
      const res = await send(admin, method, path, { revision: 1, direction: "up", linkCount: 0 });
      expect(res.status, `${method} ${path}`).toBe(404);
      expect((await errorOf(res)).code).toBe("not_found");
    }
  });

  it("deletes a category with its links and their groups, once the number of links is confirmed", async () => {
    const admin = await adminApp();
    await localGroup(admin, "Office");
    await newCategory(admin, { id: "tools", title: "Tools", groups: ["local:Office"] });
    await newCategory(admin, { id: "other", title: "Other" });
    await newLink(admin, { id: "wiki", title: "Wiki", categoryId: "tools", groups: ["local:Office"] });
    await newLink(admin, { id: "mail", title: "Mail", categoryId: "tools" });

    const wrong = await send(admin, "DELETE", "/api/admin/categories/tools", { revision: 1, linkCount: 1 });
    expect(wrong.status).toBe(409);
    const error = await errorOf(wrong);
    expect(error).toMatchObject({ code: "item_changed", linkCount: 2, current: { id: "tools", revision: 1 } });
    expect((await send(admin, "DELETE", "/api/admin/categories/tools", { revision: 2, linkCount: 2 })).status).toBe(409);

    const res = await send(admin, "DELETE", "/api/admin/categories/tools", { revision: 1, linkCount: 2 });
    expect(res.status).toBe(204);
    expect(await admin.query("select id from category")).toEqual([{ id: "other" }]);
    expect(await admin.query("select id from link")).toEqual([]);
    expect(await admin.query("select link_id from link_group")).toEqual([]);
    expect(await admin.query("select category_id from category_group where category_id = 'tools'")).toEqual([]);
    // The group itself stays.
    expect(await admin.query(`select name from "group" where source = 'local'`)).toEqual([{ name: "Office" }]);
  });

  it("refuses a 201st category", async () => {
    const admin = await adminApp();
    const values = Array.from({ length: 199 }, (_, i) => `('c${i}', 'C${i}', ${i})`).join(", ");
    await admin.exec(`insert into category (id, title, position) values ${values}`);
    await newCategory(admin, { title: "Last" });
    const res = await post(admin, "/api/admin/categories", { title: "One more", groups: [] });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe("catalog_full");
    expect(await admin.query("select count(*) as n from category")).toEqual([{ n: 200 }]);
  });
});

describe("catalog edits: links", () => {
  async function withCategory(): Promise<TestApp> {
    const admin = await adminApp();
    await newCategory(admin, { id: "tools", title: "Tools" });
    return admin;
  }

  it("creates a link with every field and reads it back", async () => {
    const admin = await withCategory();
    const res = await post(admin, "/api/admin/links", {
      categoryId: "tools",
      title: " Wiki ",
      url: "https://wiki.example.org",
      description: " Notes ",
      icon: "lucide:book",
      keywords: [" doc ", "notes"],
      groups: ["@authenticated"],
      active: false,
    });
    expect(res.status).toBe(201);
    const { link, warnings } = await linkOf(res);
    expect(link).toEqual({
      id: "wiki",
      categoryId: "tools",
      title: "Wiki",
      description: "Notes",
      url: "https://wiki.example.org",
      icon: "lucide:book",
      iconKnown: true,
      keywords: ["doc", "notes"],
      active: false,
      groups: ["@authenticated"],
      revision: 1,
    });
    expect(warnings).toEqual([]);
    expect((await adminCatalog(admin))[0]!.links).toEqual([link]);
  });

  it("changes only the fields sent, and removes the icon with null", async () => {
    const admin = await withCategory();
    const created = await newLink(admin, { id: "wiki", title: "Wiki", categoryId: "tools", icon: "si:github", keywords: ["a"], description: "D" });
    const res = await send(admin, "PATCH", "/api/admin/links/wiki", { revision: 1, title: "Team wiki", icon: null });
    expect(res.status).toBe(200);
    const { link } = await linkOf(res);
    expect(link).toEqual({ ...created, title: "Team wiki", icon: null, iconKnown: false, revision: 2 });
    const kept = await linkOf(await send(admin, "PATCH", "/api/admin/links/wiki", { revision: 2, keywords: [], url: "http://wiki.example.org/x" }));
    expect(kept.link).toMatchObject({ title: "Team wiki", keywords: [], url: "http://wiki.example.org/x", description: "D", revision: 3 });
  });

  it("warns about a link without a group, an unknown icon and groups that differ by case", async () => {
    const admin = await withCategory();
    await admin.exec(`insert into "group" (id, name, source) values ('dev', 'Developers', 'oidc')`);
    const res = await post(admin, "/api/admin/links", { categoryId: "tools", title: "A", url: "https://a.example.org", icon: "si:not-an-icon", groups: [] });
    const { link, warnings } = await linkOf(res);
    expect(link).toMatchObject({ icon: "si:not-an-icon", iconKnown: false });
    expect(warnings).toEqual(["no_group", "unknown_icon"]);

    const cased = await linkOf(await post(admin, "/api/admin/links", { categoryId: "tools", title: "B", url: "https://b.example.org", groups: ["oidc:developers"] }));
    expect(cased.warnings).toEqual(["new_oidc_group", "groups_differ_by_case"]);
    const known = await linkOf(await post(admin, "/api/admin/links", { categoryId: "tools", title: "C", url: "https://c.example.org", groups: ["oidc:Developers"] }));
    expect(known.warnings).toEqual(["groups_differ_by_case"]);
  });

  it("creates an OIDC group not seen yet, with a warning, and refuses an unknown local group", async () => {
    const admin = await withCategory();
    const res = await post(admin, "/api/admin/links", { categoryId: "tools", title: "Ops", url: "https://ops.example.org", groups: ["oidc:Ops", "@everyone"] });
    expect(res.status).toBe(201);
    const { link, warnings } = await linkOf(res);
    expect(link.groups).toEqual(["@everyone", "oidc:Ops"]);
    expect(warnings).toEqual(["new_oidc_group"]);
    expect(await admin.query(`select name, seen_at from "group" where source = 'oidc'`)).toEqual([{ name: "Ops", seen_at: null }]);
    // Seen now: no warning the second time.
    const again = await linkOf(await send(admin, "PATCH", `/api/admin/links/${link.id}`, { revision: 1, groups: ["oidc:Ops"] }));
    expect(again.warnings).toEqual([]);

    const local = await post(admin, "/api/admin/links", { categoryId: "tools", title: "X", url: "https://x.example.org", groups: ["local:Ops"] });
    expect(local.status).toBe(422);
    expect((await errorOf(local)).fields).toEqual({ groups: "unknown_group" });
    const patched = await send(admin, "PATCH", `/api/admin/links/${link.id}`, { revision: 2, groups: ["local:Ops"] });
    expect((await errorOf(patched)).fields).toEqual({ groups: "unknown_group" });
    expect(await admin.query(`select count(*) as n from link`)).toEqual([{ n: 1 }]);
  });

  it("refuses invalid fields with a code per field", async () => {
    const admin = await withCategory();
    await newCategory(admin, { id: "other", title: "Other" });
    await newLink(admin, { id: "wiki", title: "Wiki", categoryId: "other" });
    const fieldsOf = async (method: string, path: string, body: unknown) => {
      const res = await send(admin, method, path, body);
      expect(res.status).toBe(422);
      return (await errorOf(res)).fields;
    };
    const base = { categoryId: "tools", title: "T", url: "https://t.example.org", groups: [] };
    expect(await fieldsOf("POST", "/api/admin/links", {})).toEqual({ categoryId: "required", title: "required", url: "required", groups: "required" });
    expect(
      await fieldsOf("POST", "/api/admin/links", {
        ...base,
        title: " ",
        url: "javascript:alert(1)",
        description: "d".repeat(501),
        icon: "fa:book",
        groups: ["everyone"],
        active: "yes",
        id: "-bad",
      }),
    ).toEqual({ title: "required", url: "invalid_url", description: "too_long", icon: "invalid_icon", groups: "invalid_group_ref", active: "invalid", id: "invalid_id" });
    expect(await fieldsOf("POST", "/api/admin/links", { ...base, keywords: ["ok", " "] })).toEqual({ keywords: "required" });
    expect(await fieldsOf("POST", "/api/admin/links", { ...base, keywords: ["k".repeat(51)] })).toEqual({ keywords: "too_long" });
    expect(await fieldsOf("POST", "/api/admin/links", { ...base, keywords: Array.from({ length: 31 }, (_, i) => `k${i}`) })).toEqual({ keywords: "too_long" });
    expect(await fieldsOf("POST", "/api/admin/links", { ...base, categoryId: "nowhere" })).toEqual({ categoryId: "unknown_category" });
    // Link ids are unique across the catalog, not only within a category.
    expect(await fieldsOf("POST", "/api/admin/links", { ...base, id: "wiki" })).toEqual({ id: "id_taken" });
    expect(await fieldsOf("POST", "/api/admin/links", { ...base, position: 3 })).toEqual({ position: "unknown_field" });
    expect(await fieldsOf("PATCH", "/api/admin/links/wiki", { title: "x" })).toEqual({ revision: "required" });
    expect(await fieldsOf("PATCH", "/api/admin/links/wiki", { revision: 1, icon: "" })).toEqual({ icon: "invalid_icon" });
    expect(await fieldsOf("PATCH", "/api/admin/links/wiki", { revision: 1, id: "new-id" })).toEqual({ id: "unknown_field" });
    expect(await fieldsOf("PATCH", "/api/admin/links/wiki", { revision: 1, categoryId: "nowhere" })).toEqual({ categoryId: "unknown_category" });
    expect(await fieldsOf("DELETE", "/api/admin/links/wiki", {})).toEqual({ revision: "required" });
    expect((await adminCatalog(admin)).flatMap((cat) => cat.links)).toMatchObject([{ id: "wiki", title: "Wiki", revision: 1 }]);
  });

  it("derives a free id from the title, unique across categories", async () => {
    const admin = await withCategory();
    await newCategory(admin, { id: "other", title: "Other" });
    expect((await newLink(admin, { title: "Wiki", categoryId: "tools" })).id).toBe("wiki");
    expect((await newLink(admin, { title: "Wiki", categoryId: "other" })).id).toBe("wiki-2");
    expect((await newLink(admin, { title: "???", categoryId: "other" })).id).toBe("lien");
  });

  it("answers 404 for a link that does not exist", async () => {
    const admin = await withCategory();
    for (const [method, path] of WRITES.filter(([, path]) => path.includes("/links/"))) {
      const res = await send(admin, method, path, { revision: 1, direction: "up" });
      expect(res.status, `${method} ${path}`).toBe(404);
      expect((await errorOf(res)).code).toBe("not_found");
    }
  });

  it("deletes a link with its groups", async () => {
    const admin = await withCategory();
    await newLink(admin, { id: "wiki", title: "Wiki", categoryId: "tools" });
    expect((await send(admin, "DELETE", "/api/admin/links/wiki", { revision: 2 })).status).toBe(409);
    expect((await send(admin, "DELETE", "/api/admin/links/wiki", { revision: 1 })).status).toBe(204);
    expect(await admin.query("select id from link")).toEqual([]);
    expect(await admin.query("select link_id from link_group")).toEqual([]);
  });

  it("refuses a link beyond 1000 in a category, on creation and on a change of category", async () => {
    const admin = await withCategory();
    await newCategory(admin, { id: "other", title: "Other" });
    const values = Array.from({ length: 1000 }, (_, i) => `('l${i}', 'tools', 'L${i}', 'https://l.example.org', ${i})`);
    for (let i = 0; i < values.length; i += 250) {
      await admin.exec(`insert into link (id, category_id, title, url, position) values ${values.slice(i, i + 250).join(", ")}`);
    }
    const created = await post(admin, "/api/admin/links", { categoryId: "tools", title: "More", url: "https://m.example.org", groups: [] });
    expect((await errorOf(created)).code).toBe("catalog_full");
    const elsewhere = await newLink(admin, { id: "elsewhere", title: "Elsewhere", categoryId: "other" });
    const moved = await send(admin, "PATCH", "/api/admin/links/elsewhere", { revision: elsewhere.revision, categoryId: "tools" });
    expect(moved.status).toBe(409);
    expect((await errorOf(moved)).code).toBe("catalog_full");
  });
});
