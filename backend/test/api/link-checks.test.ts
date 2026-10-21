import { describe, expect, it } from "vitest";

import { adminApp, errorOf, type Link, newCategory, newLink } from "./catalog-items";
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
