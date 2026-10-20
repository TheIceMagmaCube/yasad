import type { TestApp } from "#harness";
import { describe, expect, it } from "vitest";

import { adminApp, adminCatalog, importFile } from "./catalog-items";
import { catalog, type CategorySpec, groupId, join, localUser, seedCatalogSql } from "./home-catalog";
import { addUser, post, send, signIn } from "./users";

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

/** Ids `p1`..`p<n>`, links every signed-in person sees. */
const visibleIds = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

/**
 * Return the catalog of the pin tests: `n` links open to every signed-in person (`p1`..), an inactive
 * one (`off`) and one behind a local group nobody holds (`secret`).
 */
function pinCatalog(n = 22): CategorySpec[] {
  return [
    {
      id: "c",
      groups: ["@authenticated"],
      links: [...visibleIds(n).map((id) => ({ id, groups: ["@authenticated"] })), { id: "off", groups: ["@authenticated"], active: false }],
    },
    { id: "d", groups: ["local:Ops"], links: [{ id: "secret", groups: ["local:Ops"] }] },
  ];
}

/** Return the admin and a signed-in person `b`, on the pin catalog. */
async function pinSetup(): Promise<{ admin: TestApp; b: TestApp }> {
  const admin = await adminApp();
  await importFile(admin, catalog(pinCatalog()));
  return { admin, b: await localUser(admin, "b") };
}

/** Pin `ids` one after the other, each expected to succeed. */
async function pinAll(app: TestApp, ids: string[]) {
  for (const linkId of ids) expect((await post(app, "/api/pins", { linkId })).status).toBe(200);
}

describe("POST /api/pins", () => {
  it("pins at the end, and answers the new order", async () => {
    const { b } = await pinSetup();
    const first = await post(b, "/api/pins", { linkId: "p1" });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ pins: ["p1"] });
    const second = await post(b, "/api/pins", { linkId: "p2" });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ pins: ["p1", "p2"] });
    expect(await pinsOf(b)).toEqual(["p1", "p2"]);
  });

  it("is idempotent", async () => {
    const { b } = await pinSetup();
    expect((await post(b, "/api/pins", { linkId: "p1" })).status).toBe(200);
    const again = await post(b, "/api/pins", { linkId: "p1" });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ pins: ["p1"] });
    expect(await b.query(`select count(*) as n from user_link_pin`)).toEqual([{ n: 1 }]);
  });

  it("gives the same 404 for a forbidden, an inactive and a missing link, writing nothing", async () => {
    const { b } = await pinSetup();
    const bodies = await Promise.all(
      ["secret", "off", "nope"].map(async (id) => {
        const res = await post(b, "/api/pins", { linkId: id });
        expect(res.status).toBe(404);
        return res.text();
      }),
    );
    expect(new Set(bodies).size).toBe(1);
    expect((JSON.parse(bodies[0]!) as { error: { code: string } }).error.code).toBe("not_found");
    expect(await b.query(`select * from user_link_pin`)).toEqual([]);
  });

  it("refuses the 21st pin with pins_full and max 20", async () => {
    const { b } = await pinSetup();
    await pinAll(b, visibleIds(20));
    const res = await post(b, "/api/pins", { linkId: "p21" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "pins_full", max: 20 } });
    expect(await pinsOf(b)).toEqual(visibleIds(20));
  });

  it("does not count a hidden pin", async () => {
    const { admin, b } = await pinSetup();
    await pinAll(b, visibleIds(20));
    await admin.exec(`update link set active = 0 where id = 'p3'`);
    const res = await post(b, "/api/pins", { linkId: "p21" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { pins: string[] }).pins).toEqual(visibleIds(21).filter((id) => id !== "p3"));
  });

  it("re-pins at the cap", async () => {
    const { b } = await pinSetup();
    await pinAll(b, visibleIds(20));
    const res = await post(b, "/api/pins", { linkId: "p7" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pins: visibleIds(20) });
  });

  it("the cap never answers for a link the person cannot see", async () => {
    const { b } = await pinSetup();
    await pinAll(b, visibleIds(20));
    const bodies: string[] = [];
    for (const linkId of ["secret", "off", "nope"]) {
      const res = await post(b, "/api/pins", { linkId });
      expect(res.status).toBe(404);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect((JSON.parse(bodies[0]!) as { error: { code: string } }).error.code).toBe("not_found");
    expect(await b.query(`select count(*) as n from user_link_pin`)).toEqual([{ n: 20 }]);
  });

  it("puts a new pin after a hidden one", async () => {
    const { admin, b } = await pinSetup();
    await pinAll(b, ["p1", "p2"]);
    await admin.exec(`update link set active = 0 where id = 'p2'`);
    await pinAll(b, ["p3"]);
    await admin.exec(`update link set active = 1 where id = 'p2'`);
    expect(await pinsOf(b)).toEqual(["p1", "p2", "p3"]);
    expect(await b.query(`select link_id, position from user_link_pin order by position`)).toEqual([
      { link_id: "p1", position: 0 },
      { link_id: "p2", position: 1 },
      { link_id: "p3", position: 2 },
    ]);
  });

  it("keeps the cap under concurrency", async () => {
    const { b } = await pinSetup();
    await pinAll(b, visibleIds(19));
    const statuses = await Promise.all(["p20", "p21"].map(async (linkId) => (await post(b, "/api/pins", { linkId })).status));
    expect(statuses.sort()).toEqual([200, 409]);
    expect(await pinsOf(b)).toHaveLength(20);
  });

  it("an unexplained failure answers 500 after a bounded number of attempts, with no row", async () => {
    const { b } = await pinSetup();
    await b.exec(`create trigger t before insert on user_link_pin begin select raise(abort, 'x'); end`);
    try {
      const res = await post(b, "/api/pins", { linkId: "p1" });
      expect(res.status).toBe(500);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("internal_error");
      expect(await b.query(`select * from user_link_pin`)).toEqual([]);
    } finally {
      // The D1 database outlives the test.
      await b.exec(`drop trigger if exists t`);
    }
  });

  it("refuses a malformed id with 422 invalid_input", async () => {
    const { b } = await pinSetup();
    for (const body of [{ linkId: "Bad Id" }, { linkId: 7 }, {}, { linkId: "a".repeat(65) }]) {
      const res = await post(b, "/api/pins", body);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ error: { code: "invalid_input", fields: { linkId: "invalid" } } });
    }
    expect(await b.query(`select * from user_link_pin`)).toEqual([]);
  });

  it("needs a session, a fresh password, a JSON body and the same origin", async () => {
    const { admin, b } = await pinSetup();
    const anonymous = await post(admin.another(), "/api/pins", { linkId: "p1" });
    expect(anonymous.status).toBe(401);
    expect(((await anonymous.json()) as { error: { code: string } }).error.code).toBe("unauthenticated");

    const temporary = admin.another();
    await addUser(temporary, { id: "t", email: "t@example.invalid", mustChangePassword: true });
    expect((await signIn(temporary, "t@example.invalid")).status).toBe(200);
    const fresh = await post(temporary, "/api/pins", { linkId: "p1" });
    expect(fresh.status).toBe(403);
    expect(((await fresh.json()) as { error: { code: string } }).error.code).toBe("password_change_required");

    const notJson = await b.request("/api/pins", { method: "POST", body: JSON.stringify({ linkId: "p1" }), headers: { "content-type": "text/plain" } });
    expect(notJson.status).toBe(415);
    const crossSite = await b.request("/api/pins", { method: "POST", body: JSON.stringify({ linkId: "p1" }), headers: { origin: "https://evil.test" } });
    expect(crossSite.status).toBe(403);
    expect(await b.query(`select * from user_link_pin`)).toEqual([]);
  });

  it("is not cached", async () => {
    const { admin, b } = await pinSetup();
    await pinAll(b, visibleIds(20));
    const answers = [
      await post(b, "/api/pins", { linkId: "p1" }),
      await post(admin.another(), "/api/pins", { linkId: "p1" }),
      await post(b, "/api/pins", { linkId: "nope" }),
      await post(b, "/api/pins", { linkId: "p21" }),
      await post(b, "/api/pins", { linkId: "Bad Id" }),
    ];
    expect(answers.map((res) => res.status)).toEqual([200, 401, 404, 409, 422]);
    for (const res of answers) expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("works under CATALOG_FILE", async () => {
    const admin = await adminApp({ CATALOG_FILE: "/config/catalog.yaml" });
    await seedCatalogSql(admin, pinCatalog(2));
    const b = await localUser(admin, "b");
    const res = await post(b, "/api/pins", { linkId: "p1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pins: ["p1"] });
    expect((await post(b, "/api/pins", { linkId: "secret" })).status).toBe(404);
  });
});

/** Remove the pin `linkId`, sending the JSON body the API requires. */
const unpin = (app: TestApp, linkId: string) => send(app, "DELETE", `/api/pins/${linkId}`, {});

/** Move the pin `linkId` one step. */
const movePin = (app: TestApp, linkId: string, direction: unknown) => post(app, `/api/pins/${linkId}/move`, { direction });

/** Return the person's rows, hidden ones included, in position order. */
const rowsOf = (app: TestApp, userId: string) =>
  app.query(`select link_id, position from user_link_pin where user_id = '${userId}' order by position, link_id`);

describe("DELETE /api/pins/:linkId", () => {
  it("removes a pin, and answers 200 for an absent or hidden one", async () => {
    const { admin, b } = await pinSetup();
    await pinAll(b, ["p1", "p2", "p3"]);
    const res = await unpin(b, "p1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pins: ["p2", "p3"] });
    const again = await unpin(b, "p1");
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ pins: ["p2", "p3"] });
    for (const linkId of ["secret", "off", "nope"]) {
      const absent = await unpin(b, linkId);
      expect(absent.status).toBe(200);
      expect(await absent.json()).toEqual({ pins: ["p2", "p3"] });
    }

    await admin.exec(`update link set active = 0 where id = 'p3'`);
    const hidden = await unpin(b, "p3");
    expect(hidden.status).toBe(200);
    expect(await hidden.json()).toEqual({ pins: ["p2"] });
    expect(await rowsOf(b, "b")).toEqual([{ link_id: "p2", position: 1 }]);
  });
});

describe("POST /api/pins/:linkId/move", () => {
  it("swaps with the visible neighbour, skipping a hidden pin", async () => {
    const { admin, b } = await pinSetup();
    await pinAll(b, ["p1", "p2", "p3"]);
    await admin.exec(`update link set active = 0 where id = 'p2'`);
    const res = await movePin(b, "p3", "up");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pins: ["p3", "p1"] });
    expect(await rowsOf(b, "b")).toEqual([
      { link_id: "p3", position: 0 },
      { link_id: "p2", position: 1 },
      { link_id: "p1", position: 2 },
    ]);

    const down = await movePin(b, "p3", "down");
    expect(down.status).toBe(200);
    expect(await down.json()).toEqual({ pins: ["p1", "p3"] });
    expect(await rowsOf(b, "b")).toEqual([
      { link_id: "p1", position: 0 },
      { link_id: "p2", position: 1 },
      { link_id: "p3", position: 2 },
    ]);
  });

  it("leaves the order unchanged at the ends", async () => {
    const { b } = await pinSetup();
    await pinAll(b, ["p1", "p2", "p3"]);
    const before = await rowsOf(b, "b");
    for (const [linkId, direction] of [["p1", "up"], ["p3", "down"]] as const) {
      const res = await movePin(b, linkId, direction);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ pins: ["p1", "p2", "p3"] });
    }
    expect(await rowsOf(b, "b")).toEqual(before);

    await pinAll(b, ["p4"]);
    await unpin(b, "p1");
    await unpin(b, "p2");
    await unpin(b, "p3");
    for (const direction of ["up", "down"]) {
      const alone = await movePin(b, "p4", direction);
      expect(alone.status).toBe(200);
      expect(await alone.json()).toEqual({ pins: ["p4"] });
    }
  });

  it("answers 404 for a hidden pin and for a visible link that is not pinned", async () => {
    const { admin, b } = await pinSetup();
    await pinAll(b, ["p1", "p2"]);
    await admin.exec(`update link set active = 0 where id = 'p2'`);
    const bodies: string[] = [];
    for (const linkId of ["p2", "p3", "secret", "off", "nope"]) {
      const res = await movePin(b, linkId, "up");
      expect(res.status).toBe(404);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect((JSON.parse(bodies[0]!) as { error: { code: string } }).error.code).toBe("not_found");
    expect(await rowsOf(b, "b")).toEqual([
      { link_id: "p1", position: 0 },
      { link_id: "p2", position: 1 },
    ]);
  });

  it("positions stay unique through a sequence of gestures, around a hidden pin", async () => {
    const { admin, b } = await pinSetup();
    // The model is every row of the person in position order; a move swaps the slots of two visible pins.
    const model = ["p1", "p2", "p3", "p4", "p5", "p6"];
    await pinAll(b, model);
    await admin.exec(`update link set active = 0 where id = 'p3'`);
    const hidden = new Set(["p3"]);
    const visible = () => model.filter((id) => !hidden.has(id));

    type Gesture = ["move", string, "up" | "down"] | ["unpin", string] | ["pin", string];
    const gestures: Gesture[] = [
      ["move", "p4", "up"],
      ["move", "p2", "down"],
      ["unpin", "p1"],
      ["pin", "p7"],
      ["move", "p7", "up"],
      ["move", "p7", "up"],
      ["move", "p5", "down"],
      ["unpin", "p6"],
      ["pin", "p1"],
      ["move", "p4", "up"],
    ];
    for (const gesture of gestures) {
      let res: Response;
      if (gesture[0] === "move") {
        const [, linkId, direction] = gesture;
        res = await movePin(b, linkId, direction);
        const order = visible();
        const at = order.indexOf(linkId);
        const other = order[direction === "up" ? at - 1 : at + 1];
        if (other !== undefined) {
          const i = model.indexOf(linkId);
          const j = model.indexOf(other);
          [model[i], model[j]] = [model[j]!, model[i]!];
        }
      } else if (gesture[0] === "unpin") {
        res = await unpin(b, gesture[1]);
        model.splice(model.indexOf(gesture[1]), 1);
      } else {
        res = await post(b, "/api/pins", { linkId: gesture[1] });
        model.push(gesture[1]);
      }
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ pins: visible() });
      expect(await b.query(`select count(distinct position) as d, count(*) as n from user_link_pin where user_id = 'b'`)).toEqual([
        { d: model.length, n: model.length },
      ]);
      expect((await rowsOf(b, "b")).map((row) => row.link_id)).toEqual(model);
    }
    await admin.exec(`update link set active = 1 where id = 'p3'`);
    expect(await pinsOf(b)).toEqual(model);
  });

  it("never touches another person's pins", async () => {
    const { admin, b } = await pinSetup();
    await pinAll(b, ["p1", "p2"]);
    const removed = await unpin(admin, "p1");
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ pins: [] });
    expect((await movePin(admin, "p2", "up")).status).toBe(404);
    expect(await pinsOf(b)).toEqual(["p1", "p2"]);
    expect(await rowsOf(b, "b")).toEqual([
      { link_id: "p1", position: 0 },
      { link_id: "p2", position: 1 },
    ]);
  });

  it("refuses a malformed id or direction with 422", async () => {
    const { b } = await pinSetup();
    await pinAll(b, ["p1", "p2"]);
    for (const res of [await unpin(b, "Bad%20Id"), await unpin(b, "a".repeat(65)), await movePin(b, "Bad%20Id", "up")]) {
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ error: { code: "invalid_input", fields: { linkId: "invalid" } } });
    }
    for (const res of [await movePin(b, "p2", "left"), await post(b, "/api/pins/p2/move", {}), await post(b, "/api/pins/p2/move", { direction: "up", by: 2 })]) {
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ error: { code: "invalid_input" } });
    }
    expect(await pinsOf(b)).toEqual(["p1", "p2"]);
  });

  it("needs a session, and is not cached", async () => {
    const { admin, b } = await pinSetup();
    await pinAll(b, ["p1"]);
    const answers = [
      await unpin(admin.another(), "p1"),
      await movePin(admin.another(), "p1", "up"),
      await movePin(b, "p1", "up"),
      await unpin(b, "p1"),
      await movePin(b, "p1", "up"),
      await unpin(b, "Bad%20Id"),
    ];
    expect(answers.map((res) => res.status)).toEqual([401, 401, 200, 200, 404, 422]);
    for (const res of answers) expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("works under CATALOG_FILE", async () => {
    const admin = await adminApp({ CATALOG_FILE: "/config/catalog.yaml" });
    await seedCatalogSql(admin, pinCatalog(2));
    const b = await localUser(admin, "b");
    await pinAll(b, ["p1", "p2"]);
    expect(await (await movePin(b, "p2", "up")).json()).toEqual({ pins: ["p2", "p1"] });
    expect(await (await unpin(b, "p2")).json()).toEqual({ pins: ["p1"] });
  });
});
