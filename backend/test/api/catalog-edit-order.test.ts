import { type TestApp } from "#harness";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { adminApp, adminCatalog, errorOf, importFile, newCategory, newLink, positions } from "./catalog-items";
import { post, send } from "./users";

/** Return an admin with categories a, b, c and links a1..a4 in category a. */
async function filled(): Promise<TestApp> {
  const admin = await adminApp();
  for (const id of ["a", "b", "c"]) await newCategory(admin, { id, title: id.toUpperCase() });
  for (const id of ["a1", "a2", "a3", "a4"]) await newLink(admin, { id, title: id, categoryId: "a" });
  return admin;
}

const move = (app: TestApp, kind: "categories" | "links", id: string, direction: "up" | "down") =>
  post(app, `/api/admin/${kind}/${id}/move`, { direction });

/** Return the order of the exported catalog file. */
async function exportedOrder(app: TestApp) {
  const file = parse(await (await app.request("/api/admin/catalog")).text()) as { categories: { id: string; links: { id: string }[] }[] };
  return file.categories.map((cat) => [cat.id, cat.links.map((lnk) => lnk.id)]);
}

describe("catalog edits: order", () => {
  it("moves a link one step within its category, and stays put at either end", async () => {
    const admin = await filled();
    expect(await positions(admin, "a")).toEqual([["a1", 0], ["a2", 1], ["a3", 2], ["a4", 3]]);
    let res = await move(admin, "links", "a3", "up");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ order: ["a1", "a3", "a2", "a4"] });
    expect(await (await move(admin, "links", "a1", "up")).json()).toEqual({ order: ["a1", "a3", "a2", "a4"] });
    expect(await (await move(admin, "links", "a4", "down")).json()).toEqual({ order: ["a1", "a3", "a2", "a4"] });
    res = await move(admin, "links", "a1", "down");
    expect(await res.json()).toEqual({ order: ["a3", "a1", "a2", "a4"] });
    expect(await positions(admin, "a")).toEqual([["a3", 0], ["a1", 1], ["a2", 2], ["a4", 3]]);
    // A move changes no content: the revision stays, so an open edit panel is not refused.
    expect((await adminCatalog(admin))[0]!.links.map((lnk) => lnk.revision)).toEqual([1, 1, 1, 1]);
    expect(await exportedOrder(admin)).toEqual([["a", ["a3", "a1", "a2", "a4"]], ["b", []], ["c", []]]);
  });

  it("moves categories one step, and stays put at either end", async () => {
    const admin = await filled();
    expect(await (await move(admin, "categories", "c", "up")).json()).toEqual({ order: ["a", "c", "b"] });
    expect(await (await move(admin, "categories", "a", "up")).json()).toEqual({ order: ["a", "c", "b"] });
    expect(await (await move(admin, "categories", "b", "down")).json()).toEqual({ order: ["a", "c", "b"] });
    expect(await (await move(admin, "categories", "a", "down")).json()).toEqual({ order: ["c", "a", "b"] });
    expect(await positions(admin)).toEqual([["c", 0], ["a", 1], ["b", 2]]);
    expect((await adminCatalog(admin)).map((cat) => cat.id)).toEqual(["c", "a", "b"]);
  });

  it("swaps with the neighbour in the stored order, and makes a list with gaps dense", async () => {
    const admin = await filled();
    await admin.exec(`update link set position = case id when 'a1' then 3 when 'a2' then 3 when 'a3' then 10 else -5 end`);
    // Stored order: a4 (-5), a1 (3), a2 (3), a3 (10).
    expect(await (await move(admin, "links", "a2", "up")).json()).toEqual({ order: ["a4", "a2", "a1", "a3"] });
    expect(await positions(admin, "a")).toEqual([["a4", 0], ["a2", 1], ["a1", 2], ["a3", 3]]);
  });

  it("keeps positions a permutation under simultaneous moves", async () => {
    const admin = await filled();
    const moves = await Promise.all([
      move(admin, "links", "a1", "down"),
      move(admin, "links", "a4", "up"),
      move(admin, "links", "a2", "down"),
      move(admin, "links", "a3", "up"),
      move(admin, "links", "a1", "down"),
    ]);
    expect(moves.map((res) => res.status)).toEqual([200, 200, 200, 200, 200]);
    const stored = await positions(admin, "a");
    expect(stored.map(([, position]) => position)).toEqual([0, 1, 2, 3]);
    expect(stored.map(([id]) => id).sort()).toEqual(["a1", "a2", "a3", "a4"]);
  });

  it("places a link moved to another category last, and renumbers the one it leaves", async () => {
    const admin = await filled();
    await newLink(admin, { id: "b1", title: "b1", categoryId: "b" });
    const res = await send(admin, "PATCH", "/api/admin/links/a2", { revision: 1, categoryId: "b" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ link: { id: "a2", categoryId: "b", revision: 2 } });
    expect(await positions(admin, "a")).toEqual([["a1", 0], ["a3", 1], ["a4", 2]]);
    expect(await positions(admin, "b")).toEqual([["b1", 0], ["a2", 1]]);
  });

  it("keeps lists dense after deleting an item in the middle", async () => {
    const admin = await filled();
    expect((await send(admin, "DELETE", "/api/admin/links/a2", { revision: 1 })).status).toBe(204);
    expect(await positions(admin, "a")).toEqual([["a1", 0], ["a3", 1], ["a4", 2]]);
    expect((await send(admin, "DELETE", "/api/admin/categories/b", { revision: 1, linkCount: 0 })).status).toBe(204);
    expect(await positions(admin)).toEqual([["a", 0], ["c", 1]]);
    await newCategory(admin, { id: "d", title: "D" });
    expect(await positions(admin)).toEqual([["a", 0], ["c", 1], ["d", 2]]);
  });

  it("keeps the order of a file imported after a deletion in the middle", async () => {
    const admin = await filled();
    // With a gap left (a1 at 0, a4 at 3), the import would place a5 at 2, before a4.
    expect((await send(admin, "DELETE", "/api/admin/links/a2", { revision: 1 })).status).toBe(204);
    expect((await send(admin, "DELETE", "/api/admin/links/a3", { revision: 1 })).status).toBe(204);
    const yaml = JSON.stringify({
      version: 1,
      categories: [
        {
          id: "a",
          title: "A",
          groups: ["@everyone"],
          links: ["a1", "a4", "a5"].map((id) => ({ id, title: id, url: "https://example.org", groups: ["@everyone"] })),
        },
      ],
    });
    await importFile(admin, yaml);
    expect(await exportedOrder(admin)).toEqual([["a", ["a1", "a4", "a5"]]]);
  });

  it("exports items made in the app so that importing the file back changes nothing", async () => {
    const admin = await filled();
    await admin.exec(`insert into "group" (id, name, source) values ('ops', 'Ops', 'local')`);
    await newLink(admin, { id: "full", title: "Full", categoryId: "b", description: "D", icon: "si:github", keywords: ["k"], groups: ["local:Ops", "oidc:Dev"], active: false });
    await move(admin, "links", "a4", "up");
    const yaml = await (await admin.request("/api/admin/catalog")).text();
    const preview = await post(admin, "/api/admin/catalog", { yaml, dryRun: true });
    const { diff } = (await preview.json()) as { diff: Record<string, unknown> };
    for (const part of ["added", "updated", "removed"]) expect(diff[part], part).toEqual({ categories: [], links: [] });
  });
});

describe("catalog edits: concurrent admins", () => {
  it("refuses a change made from a stale revision, with the stored item", async () => {
    const admin = await filled();
    expect((await send(admin, "PATCH", "/api/admin/links/a1", { revision: 1, title: "First" })).status).toBe(200);
    const res = await send(admin, "PATCH", "/api/admin/links/a1", { revision: 1, title: "Second" });
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toMatchObject({ code: "item_changed", current: { id: "a1", title: "First", revision: 2 } });
    // Overwriting is allowed once the current revision is known.
    expect((await send(admin, "PATCH", "/api/admin/links/a1", { revision: 2, title: "Second" })).status).toBe(200);

    const category = await send(admin, "PATCH", "/api/admin/categories/a", { revision: 5, title: "X" });
    expect(await errorOf(category)).toMatchObject({ code: "item_changed", current: { id: "a", revision: 1 } });
    expect((await errorOf(await send(admin, "DELETE", "/api/admin/links/a1", { revision: 2 }))).code).toBe("item_changed");
  });

  it("answers 404 to a change of a link deleted meanwhile", async () => {
    const admin = await filled();
    expect((await send(admin, "DELETE", "/api/admin/links/a1", { revision: 1 })).status).toBe(204);
    const res = await send(admin, "PATCH", "/api/admin/links/a1", { revision: 1, title: "Late" });
    expect(res.status).toBe(404);
  });

  it("makes an edit started before an import stale, and an import preview stale after an edit", async () => {
    const admin = await filled();
    const yaml = (await (await admin.request("/api/admin/catalog")).text()).replace("title: a1", "title: Renamed");
    await importFile(admin, yaml);
    const res = await send(admin, "PATCH", "/api/admin/links/a1", { revision: 1, title: "Mine" });
    expect(await errorOf(res)).toMatchObject({ code: "item_changed", current: { title: "Renamed", revision: 2 } });

    const preview = await post(admin, "/api/admin/catalog", { yaml, dryRun: true });
    const { baseVersion } = (await preview.json()) as { baseVersion: string };
    expect((await move(admin, "links", "a2", "up")).status).toBe(200);
    const applied = await post(admin, "/api/admin/catalog", { yaml, dryRun: false, baseVersion });
    expect(applied.status).toBe(409);
    expect((await errorOf(applied)).code).toBe("catalog_changed");
  });
});
