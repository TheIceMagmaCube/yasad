import type { TestApp } from "#harness";
import { describe, expect, it } from "vitest";

import { adminApp, adminCatalog, errorOf, type Link, newCategory, newLink } from "./catalog-items";
import { send } from "./users";

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
