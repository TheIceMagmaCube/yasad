import type { TestApp } from "#harness";
import { describe, expect, it } from "vitest";

import { adminApp, adminCatalog, importFile } from "./catalog-items";
import { catalog, groupId, join, localUser } from "./home-catalog";
import { send } from "./users";

describe("user_link_pin", () => {
  it("cascades from the user and from the link", async () => {
    const admin = await adminApp();
    await importFile(
      admin,
      catalog([{ id: "c", groups: ["@everyone"], links: [{ id: "l1", groups: ["@everyone"] }, { id: "l2", groups: ["@everyone"] }] }]),
    );
    await localUser(admin, "b");
    await admin.exec(`insert into user_link_pin (user_id, link_id, position) values ('ada', 'l1', 0), ('b', 'l2', 0)`);
    expect(await admin.query(`select user_id, link_id, position from user_link_pin where user_id = 'ada'`)).toEqual([
      { user_id: "ada", link_id: "l1", position: 0 },
    ]);
    await admin.exec(`delete from link where id = 'l1'`);
    await admin.exec(`delete from user where id = 'b'`);
    expect(await admin.query(`select * from user_link_pin`)).toEqual([]);
  });
});

/** Return the `pins` of the home page as the client reads it. */
async function pinsOf(app: TestApp): Promise<string[]> {
  const res = await app.request("/api/home");
  expect(res.status).toBe(200);
  return ((await res.json()) as { pins: string[] }).pins;
}

/** Return the stored revision of a link, as the admin screen reads it. */
async function revisionOf(admin: TestApp, linkId: string): Promise<number> {
  const found = (await adminCatalog(admin)).flatMap((cat) => cat.links).find((lnk) => lnk.id === linkId);
  expect(found).toBeDefined();
  return found!.revision;
}

describe("GET /api/home, pins", () => {
  it("reads the pins in (position, link_id) order, visible ones only", async () => {
    const admin = await adminApp();
    await importFile(
      admin,
      catalog([
        {
          id: "c",
          groups: ["@authenticated"],
          links: [
            { id: "l1", groups: ["@authenticated"] },
            { id: "l2", groups: ["@authenticated"] },
            { id: "l3", groups: ["@authenticated"] },
          ],
        },
      ]),
    );
    const b = await localUser(admin, "b");
    await admin.exec(`insert into user_link_pin (user_id, link_id, position) values ('b', 'l2', 0), ('b', 'l1', 0), ('b', 'l3', 5)`);
    expect(await pinsOf(b)).toEqual(["l1", "l2", "l3"]);
    await admin.exec(`update link set active = 0 where id = 'l2'`);
    expect(await pinsOf(b)).toEqual(["l1", "l3"]);
  });

  it("hides a pin when access is lost, and brings it back in place", async () => {
    const admin = await adminApp();
    await importFile(
      admin,
      catalog([
        { id: "c", groups: ["@authenticated"], links: [{ id: "l1", groups: ["@authenticated"] }, { id: "l3", groups: ["@authenticated"] }] },
        { id: "d", groups: ["local:Ops"], links: [{ id: "l2", groups: ["local:Dev"] }] },
      ]),
    );
    const b = await localUser(admin, "b");
    await join(admin, "b", "Dev");
    await join(admin, "b", "Ops");
    await admin.exec(`insert into user_link_pin (user_id, link_id, position) values ('b', 'l1', 0), ('b', 'l2', 1), ('b', 'l3', 2)`);
    expect(await pinsOf(b)).toEqual(["l1", "l2", "l3"]);

    for (const name of ["Dev", "Ops"]) {
      const id = await groupId(admin, "local", name);
      expect((await send(admin, "DELETE", `/api/admin/groups/${id}/members/b`)).status).toBe(204);
      expect(await pinsOf(b)).toEqual(["l1", "l3"]);
      await join(admin, "b", name);
      expect(await pinsOf(b)).toEqual(["l1", "l2", "l3"]);
    }

    expect((await send(admin, "PATCH", "/api/admin/links/l2", { revision: await revisionOf(admin, "l2"), active: false })).status).toBe(200);
    expect(await pinsOf(b)).toEqual(["l1", "l3"]);
    expect((await send(admin, "PATCH", "/api/admin/links/l2", { revision: await revisionOf(admin, "l2"), active: true })).status).toBe(200);
    expect(await pinsOf(b)).toEqual(["l1", "l2", "l3"]);
    expect(await admin.query(`select link_id, position from user_link_pin where user_id = 'b' order by position`)).toEqual([
      { link_id: "l1", position: 0 },
      { link_id: "l2", position: 1 },
      { link_id: "l3", position: 2 },
    ]);
  });

  it("never shows a person's pins to another one", async () => {
    const admin = await adminApp();
    await importFile(admin, catalog([{ id: "c", groups: ["@authenticated"], links: [{ id: "l1", groups: ["@authenticated"] }] }]));
    const b = await localUser(admin, "b");
    await admin.exec(`insert into user_link_pin (user_id, link_id, position) values ('b', 'l1', 0)`);
    expect(await pinsOf(b)).toEqual(["l1"]);
    expect(await pinsOf(admin)).toEqual([]);
  });

  it("sends pins: [] to an anonymous visitor even with rows for @everyone links", async () => {
    const admin = await adminApp();
    await importFile(admin, catalog([{ id: "c", groups: ["@everyone"], links: [{ id: "l1", groups: ["@everyone"] }] }]));
    await admin.exec(`insert into user_link_pin (user_id, link_id, position) values ('ada', 'l1', 0)`);
    expect(await pinsOf(admin)).toEqual(["l1"]);
    const res = await admin.another().request("/api/home");
    const body = (await res.json()) as { signedIn: boolean; categories: { id: string }[]; pins: string[] };
    expect(body.signedIn).toBe(false);
    expect(body.categories.map((cat) => cat.id)).toEqual(["c"]);
    expect(body.pins).toEqual([]);
  });
});
