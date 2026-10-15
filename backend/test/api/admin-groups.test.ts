import { type TestApp, testApp } from "#harness";
import { describe, expect, it } from "vitest";

import { addOidcUser, addUser, post, send, signIn } from "./users";

type AdminGroup = { id: string; name: string; source: string; memberIds: string[]; categories: number; links: number };

async function adminApp(): Promise<TestApp> {
  const app = await testApp();
  await addUser(app, { id: "ada", email: "ada@example.invalid", role: "admin" });
  expect((await signIn(app, "ada@example.invalid")).status).toBe(200);
  return app;
}

async function groups(app: TestApp): Promise<AdminGroup[]> {
  return ((await (await app.request("/api/admin/groups")).json()) as { groups: AdminGroup[] }).groups;
}

async function create(app: TestApp, name: string): Promise<AdminGroup> {
  const res = await post(app, "/api/admin/groups", { name });
  expect(res.status).toBe(201);
  return ((await res.json()) as { group: AdminGroup }).group;
}

const codeOf = async (res: Response) => ((await res.json()) as { error: { code: string; fields?: object } }).error;

const CATALOG = `version: 1
categories:
  - id: tools
    title: Tools
    groups: ["local:Contractors"]
    links:
      - id: mail
        title: Mail
        url: https://mail.example.org
        groups: ["local:Contractors", "@everyone"]
`;

describe("admin groups", () => {
  it("is refused without a session and to non-admins", async () => {
    const app = await testApp();
    const routes: [string, string][] = [
      ["GET", "/api/admin/groups"],
      ["POST", "/api/admin/groups"],
      ["PATCH", "/api/admin/groups/g1"],
      ["DELETE", "/api/admin/groups/g1"],
      ["PUT", "/api/admin/groups/g1/members/bob"],
      ["DELETE", "/api/admin/groups/g1/members/bob"],
    ];
    for (const [method, path] of routes) expect((await send(app, method, path)).status).toBe(401);
    await addUser(app, { id: "bob", email: "bob@example.invalid" });
    await signIn(app, "bob@example.invalid");
    for (const [method, path] of routes) expect((await send(app, method, path)).status).toBe(403);
  });

  it("creates and renames local groups, refusing invalid and taken names", async () => {
    const app = await adminApp();
    const group = await create(app, "  Contractors ");
    expect(group).toMatchObject({ name: "Contractors", source: "local", memberIds: [] });
    expect((await codeOf(await post(app, "/api/admin/groups", { name: "Contractors" }))).fields).toEqual({ name: "name_taken" });
    expect((await codeOf(await post(app, "/api/admin/groups", { name: " " }))).fields).toEqual({ name: "invalid_name" });

    await create(app, "Vendors");
    expect((await codeOf(await send(app, "PATCH", `/api/admin/groups/${group.id}`, { name: "Vendors" }))).fields).toEqual({ name: "name_taken" });
    const renamed = await send(app, "PATCH", `/api/admin/groups/${group.id}`, { name: "Partners" });
    expect(((await renamed.json()) as { group: AdminGroup }).group.name).toBe("Partners");
  });

  it("lists system groups first, then others by name", async () => {
    const app = await adminApp();
    await create(app, "Zeta");
    await create(app, "Alpha");
    await app.exec(`insert into "group" (id, name, source) values ('o1', 'Developers', 'oidc')`);
    expect((await groups(app)).map((g) => `${g.source}:${g.name}`)).toEqual(["system:authenticated", "system:everyone", "local:Alpha", "local:Zeta", "oidc:Developers"]);
  });

  it("adds local and OIDC accounts to a local group, and removes them", async () => {
    const app = await adminApp();
    await addOidcUser(app, { id: "carol", email: "carol@example.invalid" });
    const group = await create(app, "Contractors");
    for (const id of ["ada", "carol", "carol"]) expect((await send(app, "PUT", `/api/admin/groups/${group.id}/members/${id}`)).status).toBe(204);
    expect((await groups(app)).find((g) => g.id === group.id)!.memberIds.sort()).toEqual(["ada", "carol"]);
    expect((await send(app, "PUT", `/api/admin/groups/${group.id}/members/nobody`)).status).toBe(404);

    expect((await send(app, "DELETE", `/api/admin/groups/${group.id}/members/carol`)).status).toBe(204);
    expect((await groups(app)).find((g) => g.id === group.id)!.memberIds).toEqual(["ada"]);
  });

  it("keeps OIDC and system groups read-only", async () => {
    const app = await adminApp();
    await app.exec(`insert into "group" (id, name, source) values ('o1', 'Developers', 'oidc')`);
    for (const id of ["o1", "system:everyone"]) {
      for (const [method, path, body] of [
        ["PATCH", `/api/admin/groups/${id}`, { name: "Renamed" }],
        ["DELETE", `/api/admin/groups/${id}`, {}],
        ["PUT", `/api/admin/groups/${id}/members/ada`, {}],
        ["DELETE", `/api/admin/groups/${id}/members/ada`, {}],
      ] as const) {
        const res = await send(app, method, path, body);
        expect(res.status).toBe(409);
        expect((await codeOf(res)).code).toBe("read_only_group");
      }
    }
    expect((await send(app, "DELETE", "/api/admin/groups/missing")).status).toBe(404);
  });

  it("counts catalog use, and deleting a used group removes it from the catalog", async () => {
    const app = await adminApp();
    const preview = await post(app, "/api/admin/catalog", { yaml: CATALOG, dryRun: true });
    await post(app, "/api/admin/catalog", { yaml: CATALOG, dryRun: false, baseVersion: ((await preview.json()) as { baseVersion: string }).baseVersion });
    const group = (await groups(app)).find((g) => g.name === "Contractors")!;
    expect(group).toMatchObject({ categories: 1, links: 1 });
    await send(app, "PUT", `/api/admin/groups/${group.id}/members/ada`);

    const before = ((await (await post(app, "/api/admin/catalog", { yaml: CATALOG, dryRun: true })).json()) as { baseVersion: string }).baseVersion;
    expect((await send(app, "DELETE", `/api/admin/groups/${group.id}`)).status).toBe(204);
    for (const table of ["user_group", "category_group", "link_group"]) {
      expect(await app.query(`select count(*) as n from ${table} where group_id = '${group.id}'`)).toEqual([{ n: 0 }]);
    }
    const exported = await (await app.request("/api/admin/catalog")).text();
    expect(exported).not.toContain("Contractors");
    const stale = await post(app, "/api/admin/catalog", { yaml: CATALOG, dryRun: false, baseVersion: before });
    expect((await codeOf(stale)).code).toBe("catalog_changed");
  });

  it("renaming a group keeps it in the catalog, under its new name", async () => {
    const app = await adminApp();
    const preview = await post(app, "/api/admin/catalog", { yaml: CATALOG, dryRun: true });
    await post(app, "/api/admin/catalog", { yaml: CATALOG, dryRun: false, baseVersion: ((await preview.json()) as { baseVersion: string }).baseVersion });
    const group = (await groups(app)).find((g) => g.name === "Contractors")!;
    await send(app, "PATCH", `/api/admin/groups/${group.id}`, { name: "Partners" });
    const exported = await (await app.request("/api/admin/catalog")).text();
    expect(exported).toContain("local:Partners");
    expect(exported).not.toContain("Contractors");
  });
});
