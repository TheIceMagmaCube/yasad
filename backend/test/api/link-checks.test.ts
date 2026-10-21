import type { TestApp } from "#harness";
import { describe, expect, it } from "vitest";

import { parse } from "yaml";

import { auditCount, history } from "./audit";
import { adminApp, adminCatalog, errorOf, importFile, type Link, newCategory, newLink } from "./catalog-items";
import { post, send } from "./users";

async function linkOf(res: Response) {
  return ((await res.json()) as { link: Link }).link;
}

describe("link checks: setting", () => {
  it("stores check on create, off unless asked", async () => {
    const admin = await adminApp();
    await newCategory(admin, { id: "tools", title: "Tools" });
    expect((await newLink(admin, { id: "wiki", title: "Wiki", categoryId: "tools" })).check).toBe(false);
    expect((await newLink(admin, { id: "mail", title: "Mail", categoryId: "tools", check: true })).check).toBe(true);
    expect(await admin.query("select id, check_enabled from link order by id")).toEqual([
      { id: "mail", check_enabled: 1 },
      { id: "wiki", check_enabled: 0 },
    ]);
  });

  it("changes check with PATCH and stores it in the column", async () => {
    const admin = await adminApp();
    await newCategory(admin, { id: "tools", title: "Tools" });
    const created = await newLink(admin, { id: "wiki", title: "Wiki", categoryId: "tools" });

    const on = await send(admin, "PATCH", "/api/admin/links/wiki", { revision: created.revision, check: true });
    expect(on.status).toBe(200);
    const checked = await linkOf(on);
    expect(checked).toMatchObject({ check: true, revision: created.revision + 1 });
    expect(await admin.query("select check_enabled from link")).toEqual([{ check_enabled: 1 }]);

    const off = await send(admin, "PATCH", "/api/admin/links/wiki", { revision: checked.revision, check: false });
    expect(off.status).toBe(200);
    expect((await linkOf(off)).check).toBe(false);
    expect(await admin.query("select check_enabled from link")).toEqual([{ check_enabled: 0 }]);
  });

  it("refuses a check that is not a boolean", async () => {
    const admin = await adminApp();
    await newCategory(admin, { id: "tools", title: "Tools" });
    const created = await newLink(admin, { id: "wiki", title: "Wiki", categoryId: "tools" });
    for (const [method, path, body] of [
      ["POST", "/api/admin/links", { id: "mail", title: "Mail", categoryId: "tools", url: "https://example.org", groups: ["@everyone"], check: "yes" }],
      ["PATCH", "/api/admin/links/wiki", { revision: created.revision, check: "yes" }],
    ] as const) {
      const res = await send(admin, method, path, body);
      expect(res.status, method).toBe(422);
      const error = await errorOf(res);
      expect(error.code).toBe("invalid_input");
      expect(error.fields).toEqual({ check: "invalid" });
    }
    expect(await admin.query("select id, check_enabled from link")).toEqual([{ id: "wiki", check_enabled: 0 }]);
  });

  it("leaves check alone while CATALOG_FILE manages the catalog", async () => {
    const admin = await adminApp({ CATALOG_FILE: "/config/catalog.yaml" });
    await admin.exec(`insert into category (id, title, position) values ('tools', 'Tools', 0)`);
    await admin.exec(`insert into link (id, category_id, title, url, position) values ('wiki', 'tools', 'Wiki', 'https://wiki.example.org', 0)`);
    const res = await send(admin, "PATCH", "/api/admin/links/wiki", { revision: 1, check: true });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe("catalog_managed_by_file");
    expect(await admin.query("select check_enabled, revision from link")).toEqual([{ check_enabled: 0, revision: 1 }]);
  });
});

/** Store a check result as the scheduler will, straight in the database. */
const storeStatus = (app: TestApp, linkId: string, state: string | null = "down") =>
  app.exec(
    `insert into link_status (link_id, source, state, reason, http_status, checked_at, due_at)
     values ('${linkId}', 'yasad', ${state === null ? "null" : `'${state}'`}, 'http_error', 502, 1760000000000, 1760000300000)`,
  );
const statusRows = (app: TestApp) => app.query("select link_id from link_status order by link_id");

const DOWN = { state: "down", reason: "http_error", httpStatus: 502, checkedAt: new Date(1760000000000).toISOString() };

/** Return an admin client with a checked link `wiki`, its stored result, in the category `tools`. */
async function checkedLink() {
  const admin = await adminApp();
  await newCategory(admin, { id: "tools", title: "Tools" });
  await newCategory(admin, { id: "other", title: "Other" });
  const created = await newLink(admin, { id: "wiki", title: "Wiki", categoryId: "tools", url: "https://wiki.example.org", check: true });
  await storeStatus(admin, "wiki");
  return { admin, created };
}

describe("link checks: stored result", () => {
  it("shows the last result of a checked link to admins", async () => {
    const { admin, created } = await checkedLink();
    await newLink(admin, { id: "mail", title: "Mail", categoryId: "tools", check: true });
    await storeStatus(admin, "mail", null);
    await newLink(admin, { id: "chat", title: "Chat", categoryId: "tools" });
    await storeStatus(admin, "chat");

    const links = (await adminCatalog(admin))[0]!.links;
    expect(Object.fromEntries(links.map((l) => [l.id, l.status]))).toEqual({ wiki: DOWN, mail: null, chat: null });

    const res = await send(admin, "PATCH", "/api/admin/links/wiki", { revision: created.revision, title: "Docs" });
    expect(res.status).toBe(200);
    expect((await linkOf(res)).status).toEqual(DOWN);
  });

  it("keeps the result when anything but the address changes", async () => {
    const { admin, created } = await checkedLink();
    let revision = created.revision;
    for (const change of [
      { title: "Docs" },
      { description: "Notes" },
      { groups: ["@authenticated"] },
      { active: false },
      { categoryId: "other" },
      { url: "https://wiki.example.org" },
    ]) {
      const res = await send(admin, "PATCH", "/api/admin/links/wiki", { revision, ...change });
      expect(res.status, JSON.stringify(change)).toBe(200);
      const link = await linkOf(res);
      expect(link.revision).toBe(revision + 1);
      revision = link.revision;
      expect(await statusRows(admin), JSON.stringify(change)).toEqual([{ link_id: "wiki" }]);
    }
  });

  it("forgets the result when the address changes", async () => {
    const { admin, created } = await checkedLink();
    const res = await send(admin, "PATCH", "/api/admin/links/wiki", { revision: created.revision, url: "https://docs.example.org" });
    expect(res.status).toBe(200);
    expect((await linkOf(res)).status).toBeNull();
    expect(await statusRows(admin)).toEqual([]);
  });

  it("forgets the result when the link is no longer checked", async () => {
    const { admin, created } = await checkedLink();
    const res = await send(admin, "PATCH", "/api/admin/links/wiki", { revision: created.revision, check: false });
    expect(res.status).toBe(200);
    expect(await statusRows(admin)).toEqual([]);
  });

  it("keeps the result when the edit is refused", async () => {
    const { admin, created } = await checkedLink();
    const res = await send(admin, "PATCH", "/api/admin/links/wiki", { revision: created.revision + 1, url: "https://docs.example.org" });
    expect(res.status).toBe(409);
    expect(await statusRows(admin)).toEqual([{ link_id: "wiki" }]);
  });

  it("drops the result with the link", async () => {
    const { admin, created } = await checkedLink();
    expect((await send(admin, "DELETE", "/api/admin/links/wiki", { revision: created.revision })).status).toBe(204);
    expect(await statusRows(admin)).toEqual([]);
  });

  it("drops the result with the category of the link", async () => {
    const { admin } = await checkedLink();
    expect((await send(admin, "DELETE", "/api/admin/categories/tools", { revision: 1, linkCount: 1 })).status).toBe(204);
    expect(await statusRows(admin)).toEqual([]);
  });
});

/** A catalog file with a checked link `wiki` and an unchecked link `mail`. */
const fileWith = ({ url = "https://wiki.example.org", title = "Wiki", check = true } = {}) => `version: 1
categories:
  - id: tools
    title: Tools
    groups: ["@everyone"]
    links:
      - id: wiki
        title: ${title}
        url: ${url}
        groups: ["@everyone"]
${check ? "        check: true\n" : ""}      - id: mail
        title: Mail
        url: https://mail.example.org
        groups: ["@everyone"]
`;

type Preview = { diff: { added: { links: string[] }; updated: { categories: string[]; links: string[] }; removed: { links: string[] } } };
async function preview(app: TestApp, yaml: string) {
  const res = await post(app, "/api/admin/catalog", { yaml, dryRun: true });
  expect(res.status).toBe(200);
  return ((await res.json()) as Preview).diff;
}

describe("link checks: catalog file", () => {
  it("imports check into the column", async () => {
    const admin = await adminApp();
    await importFile(admin, fileWith());
    expect(await admin.query("select id, check_enabled from link order by id")).toEqual([
      { id: "mail", check_enabled: 0 },
      { id: "wiki", check_enabled: 1 },
    ]);
    const links = (await adminCatalog(admin))[0]!.links;
    expect(Object.fromEntries(links.map((l) => [l.id, l.check]))).toEqual({ wiki: true, mail: false });
  });

  it("exports check only when true, and re-importing the export changes nothing", async () => {
    const admin = await adminApp();
    await importFile(admin, fileWith());
    const exported = await (await admin.request("/api/admin/catalog")).text();
    const links = (parse(exported) as { categories: { links: Record<string, unknown>[] }[] }).categories[0]!.links;
    expect(links.find((l) => l.id === "wiki")!.check).toBe(true);
    expect("check" in links.find((l) => l.id === "mail")!).toBe(false);
    const diff = await preview(admin, exported);
    expect(diff.added.links).toEqual([]);
    expect(diff.updated).toEqual({ categories: [], links: [] });
    expect(diff.removed.links).toEqual([]);
  });

  it("updates a link whose check alone changes", async () => {
    const admin = await adminApp();
    await importFile(admin, fileWith());
    const before = await admin.query("select revision from link where id = 'wiki'");
    expect((await preview(admin, fileWith({ check: false }))).updated.links).toEqual(["wiki"]);
    await importFile(admin, fileWith({ check: false }));
    expect(await admin.query("select check_enabled, revision from link where id = 'wiki'")).toEqual([
      { check_enabled: 0, revision: Number(before[0]!.revision) + 1 },
    ]);
  });

  it("keeps the result when the import changes anything but the address", async () => {
    const admin = await adminApp();
    await importFile(admin, fileWith());
    await storeStatus(admin, "wiki");
    await importFile(admin, fileWith({ title: "Docs" }));
    expect(await admin.query("select title from link where id = 'wiki'")).toEqual([{ title: "Docs" }]);
    expect(await statusRows(admin)).toEqual([{ link_id: "wiki" }]);
  });

  it("forgets the result when the import changes the address", async () => {
    const admin = await adminApp();
    await importFile(admin, fileWith());
    await storeStatus(admin, "wiki");
    await importFile(admin, fileWith({ url: "https://docs.example.org" }));
    expect(await statusRows(admin)).toEqual([]);
  });

  it("forgets the result when the import no longer checks the link", async () => {
    const admin = await adminApp();
    await importFile(admin, fileWith());
    await storeStatus(admin, "wiki");
    await importFile(admin, fileWith({ check: false }));
    expect(await statusRows(admin)).toEqual([]);
  });

  it("drops the result when the import removes the link", async () => {
    const admin = await adminApp();
    await importFile(admin, fileWith());
    await storeStatus(admin, "wiki");
    const yaml = fileWith();
    await importFile(admin, yaml.slice(0, yaml.indexOf("      - id: wiki")) + yaml.slice(yaml.indexOf("      - id: mail")));
    expect(await statusRows(admin)).toEqual([]);
  });

  it("drops the result when the import removes the category of the link", async () => {
    const admin = await adminApp();
    await importFile(admin, fileWith());
    await storeStatus(admin, "wiki");
    await importFile(admin, `version: 1
categories:
  - id: other
    title: Other
    groups: ["@everyone"]
    links: []
`);
    expect(await statusRows(admin)).toEqual([]);
  });
});

describe("link checks: history", () => {
  it("logs check when a link is created and when it changes", async () => {
    const admin = await adminApp();
    await newCategory(admin, { id: "tools", title: "Tools" });
    const created = await newLink(admin, { id: "wiki", title: "Wiki", categoryId: "tools" });
    expect((await history(admin))[0]).toMatchObject({ action: "create", object: { type: "link", id: "wiki" }, after: { check: false } });

    const res = await send(admin, "PATCH", "/api/admin/links/wiki", { revision: created.revision, check: true });
    expect(res.status).toBe(200);
    expect((await history(admin))[0]).toMatchObject({ action: "update", before: { check: false }, after: { check: true } });
  });

  it("logs check when an import sets it", async () => {
    const admin = await adminApp();
    await importFile(admin, fileWith());
    const [entry] = await history(admin);
    expect(entry).toMatchObject({ action: "import", after: { links: { wiki: { check: true }, mail: { check: false } } } });
  });

  it("never logs the stored result", async () => {
    const admin = await adminApp();
    await newCategory(admin, { id: "tools", title: "Tools" });
    const created = await newLink(admin, { id: "wiki", title: "Wiki", categoryId: "tools", check: true });
    const count = await auditCount(admin);
    await storeStatus(admin, "wiki");
    expect(await auditCount(admin)).toBe(count);
    const res = await send(admin, "PATCH", "/api/admin/links/wiki", { revision: created.revision, title: "Docs" });
    expect(res.status).toBe(200);
    expect(await auditCount(admin)).toBe(count + 1);
    const log = JSON.stringify(await admin.query("select * from audit_log"));
    expect(log).not.toContain("http_error");
    expect(log).not.toContain('\\"state\\"');
  });
});
