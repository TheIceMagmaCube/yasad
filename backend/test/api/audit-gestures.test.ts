import { type TestApp, testApp } from "#harness";
import { describe, expect, it } from "vitest";

import { auditCount, history } from "./audit";
import { adminApp, errorOf, importFile, newCategory, newLink } from "./catalog-items";
import { addOidcUser, addUser, post, send, sessionCookie } from "./users";

const json = async <T>(res: Response) => (await res.json()) as T;

/** Return every column of every audit row, as one text. */
const auditText = async (app: TestApp) => JSON.stringify(await app.query("select * from audit_log"));

async function newGroup(app: TestApp, name: string): Promise<string> {
  const res = await post(app, "/api/admin/groups", { name });
  expect(res.status).toBe(201);
  return (await json<{ group: { id: string } }>(res)).group.id;
}

describe("audit: users", () => {
  it("logs a created account, its changes, a password reset and its deletion, never a secret", async () => {
    const app = await adminApp();
    const created = await post(app, "/api/admin/users", { name: "Bob", email: "bob@example.invalid" });
    const { user, temporaryPassword } = await json<{ user: { id: string }; temporaryPassword: string }>(created);
    const hashOf = async () => (await app.query(`select password from account where user_id = '${user.id}'`))[0]!.password as string;
    const secrets = [temporaryPassword, await hashOf()];
    const [create] = await history(app);
    expect(create).toMatchObject({
      actor: { id: "ada", name: "ada", email: "ada@example.invalid" },
      action: "create",
      object: { type: "user", id: user.id, label: "Bob", exists: true },
      before: null,
      after: { name: "Bob", email: "bob@example.invalid", origin: "local", role: "user", roleOverride: null, disabled: false, mustChangePassword: true, groups: [] },
    });

    expect((await send(app, "PATCH", `/api/admin/users/${user.id}`, { name: "Robert", disabled: true })).status).toBe(200);
    const [update] = await history(app);
    expect(update).toMatchObject({ action: "update", object: { label: "Robert" }, before: { name: "Bob", disabled: false }, after: { name: "Robert", disabled: true } });
    expect((await send(app, "PATCH", `/api/admin/users/${user.id}`, { name: "Robert", disabled: true })).status).toBe(200);
    expect(await auditCount(app)).toBe(2);

    const reset = await json<{ temporaryPassword: string }>(await post(app, `/api/admin/users/${user.id}/password`, {}));
    secrets.push(reset.temporaryPassword, await hashOf());
    const [password] = await history(app);
    expect(password).toMatchObject({ action: "password_reset", object: { label: "Robert" }, before: { mustChangePassword: true }, after: { mustChangePassword: true } });
    expect(Object.keys(password!.after!)).toEqual(["mustChangePassword"]);

    const groupId = await newGroup(app, "Ops");
    await send(app, "PUT", `/api/admin/groups/${groupId}/members/${user.id}`);
    expect((await send(app, "DELETE", `/api/admin/users/${user.id}`)).status).toBe(204);
    const [deleted] = await history(app);
    expect(deleted).toMatchObject({ action: "delete", object: { id: user.id, label: "Robert", exists: false }, before: { groups: ["local:Ops"] }, after: null });

    const text = await auditText(app);
    for (const secret of secrets) expect(text).not.toContain(secret);
  });

  it("logs the setup with no actor", async () => {
    const code = "setup-code-for-the-tests-0123456789";
    const app = await testApp({ SETUP_CODE: code });
    const password = "correct horse battery";
    const res = await post(app, "/api/setup", { code, name: "Ada", email: "ada@example.invalid", password, passwordConfirm: password });
    expect(res.status).toBe(201);
    const [entry] = await history(app);
    expect(entry).toMatchObject({ actor: null, action: "create", object: { type: "user", label: "Ada" }, after: { role: "admin", origin: "local" }, details: { source: "setup" } });
    expect(await auditText(app)).not.toContain(password);
  });

  it("writes no entry when the last enabled local admin is kept", async () => {
    const app = await testApp();
    await addUser(app, { id: "bob", email: "bob@example.invalid", role: "admin" });
    await addOidcUser(app, { id: "olga", email: "olga@example.invalid", role: "admin" });
    const cookie = await sessionCookie(app, "olga");
    for (const [method, body] of [
      ["PATCH", { role: "user", name: "Demoted" }],
      ["DELETE", {}],
    ] as const) {
      const res = await app.request("/api/admin/users/bob", { method, body: JSON.stringify(body), headers: { cookie } });
      expect(res.status).toBe(409);
      expect((await errorOf(res)).code).toBe("last_local_admin");
    }
    expect(await app.query("select name, role from user where id = 'bob'")).toEqual([{ name: "bob", role: "admin" }]);
    expect(await auditCount(app)).toBe(0);
  });
});

describe("audit: groups", () => {
  it("logs a group's creation, renaming, members and deletion, with what the deletion takes along", async () => {
    const app = await adminApp();
    await addUser(app, { id: "bob", email: "bob@example.invalid" });
    const id = await newGroup(app, "Ops");
    expect(await history(app)).toMatchObject([{ action: "create", object: { type: "group", id, label: "Ops" }, after: { name: "Ops", source: "local" } }]);

    await send(app, "PATCH", `/api/admin/groups/${id}`, { name: "Ops" });
    expect((await send(app, "PATCH", `/api/admin/groups/${id}`, { name: "Run" })).status).toBe(200);
    expect((await history(app))[0]).toMatchObject({ action: "update", object: { label: "Run" }, before: { name: "Ops" }, after: { name: "Run" } });

    for (let i = 0; i < 2; i++) expect((await send(app, "PUT", `/api/admin/groups/${id}/members/bob`)).status).toBe(204);
    expect((await history(app))[0]).toMatchObject({ action: "member_add", object: { id, label: "Run" }, related: { type: "user", id: "bob", label: "bob", exists: true } });
    for (let i = 0; i < 2; i++) expect((await send(app, "DELETE", `/api/admin/groups/${id}/members/bob`)).status).toBe(204);
    expect((await history(app))[0]).toMatchObject({ action: "member_remove", related: { id: "bob" } });
    expect(await auditCount(app)).toBe(4);

    await send(app, "PUT", `/api/admin/groups/${id}/members/bob`);
    const tools = await newCategory(app, { id: "tools", title: "Tools", groups: ["local:Run"] });
    await newLink(app, { id: "mail", categoryId: tools.id, title: "Mail", groups: ["local:Run"] });
    expect((await send(app, "DELETE", `/api/admin/groups/${id}`)).status).toBe(204);
    expect((await history(app))[0]).toMatchObject({
      action: "delete",
      object: { id, label: "Run", exists: false },
      before: { name: "Run", source: "local", members: [{ id: "bob", name: "bob" }], categories: ["tools"], links: ["mail"] },
      after: null,
    });
  });
});

describe("audit: catalog edits", () => {
  it("logs each change to categories and links, and moves that change a position", async () => {
    const app = await adminApp();
    const tools = await newCategory(app, { id: "tools", title: "Tools" });
    await newCategory(app, { id: "docs", title: "Docs" });
    expect((await history(app))[1]).toMatchObject({ action: "create", object: { type: "category", id: "tools", label: "Tools" }, after: { title: "Tools", position: 0, groups: ["@everyone"] } });

    const renamed = await send(app, "PATCH", "/api/admin/categories/tools", { revision: tools.revision, title: "Toolbox" });
    expect(renamed.status).toBe(200);
    expect((await history(app))[0]).toMatchObject({ action: "update", before: { title: "Tools" }, after: { title: "Toolbox" } });

    await post(app, "/api/admin/categories/docs/move", { direction: "down" });
    expect(await auditCount(app)).toBe(3);
    await post(app, "/api/admin/categories/docs/move", { direction: "up" });
    expect((await history(app))[0]).toMatchObject({ action: "move", object: { id: "docs" }, before: { position: 1 }, after: { position: 0 } });
    expect(await auditCount(app)).toBe(4);

    const mail = await newLink(app, { id: "mail", categoryId: "tools", title: "Mail", keywords: ["inbox"] });
    expect((await history(app))[0]).toMatchObject({
      action: "create",
      object: { type: "link", id: "mail", label: "Mail" },
      after: { categoryId: "tools", title: "Mail", url: "https://example.org", description: "", icon: null, keywords: ["inbox"], active: true, position: 0, groups: ["@everyone"] },
    });
    await newLink(app, { id: "wiki", categoryId: "tools", title: "Wiki" });
    await post(app, "/api/admin/links/wiki/move", { direction: "up" });
    expect((await history(app))[0]).toMatchObject({ action: "move", object: { id: "wiki" }, before: { position: 1 }, after: { position: 0 } });
    const moved = await send(app, "PATCH", "/api/admin/links/mail", { revision: mail.revision, categoryId: "docs", active: false });
    expect(moved.status).toBe(200);
    expect((await history(app))[0]).toMatchObject({ action: "update", before: { categoryId: "tools", active: true, position: 1 }, after: { categoryId: "docs", active: false, position: 0 } });
    const current = (await json<{ link: { revision: number } }>(moved)).link;
    expect((await send(app, "DELETE", "/api/admin/links/mail", { revision: current.revision })).status).toBe(204);
    expect((await history(app))[0]).toMatchObject({ action: "delete", object: { id: "mail", label: "Mail", exists: false }, before: { title: "Mail" }, after: null });

    const toolbox = await json<{ categories: { id: string; revision: number }[] }>(await app.request("/api/admin/categories"));
    const revision = toolbox.categories.find((c) => c.id === "tools")!.revision;
    expect((await send(app, "DELETE", "/api/admin/categories/tools", { revision, linkCount: 1 })).status).toBe(204);
    expect((await history(app))[0]).toMatchObject({ action: "delete", object: { label: "Toolbox" }, before: { title: "Toolbox", links: [{ id: "wiki", title: "Wiki" }] } });
  });

  it("writes no entry for a refused edit", async () => {
    const app = await adminApp();
    const tools = await newCategory(app, { id: "tools", title: "Tools" });
    const count = await auditCount(app);
    const refused = [
      await send(app, "PATCH", "/api/admin/categories/tools", { revision: tools.revision + 1, title: "Stale" }),
      await send(app, "PATCH", "/api/admin/categories/tools", { revision: tools.revision, groups: ["local:Nobody"] }),
      await send(app, "DELETE", "/api/admin/categories/tools", { revision: tools.revision, linkCount: 3 }),
    ];
    expect(await Promise.all(refused.map(async (res) => (await errorOf(res)).code))).toEqual(["item_changed", "invalid_input", "item_changed"]);
    expect(await auditCount(app)).toBe(count);
  });
});

describe("audit: catalog import", () => {
  const FILE = `version: 1
categories:
  - id: tools
    title: Tools
    groups: ["@everyone"]
    links:
      - id: mail
        title: Mail
        url: https://mail.example.org
        groups: ["local:Ops"]
`;

  it("logs one entry per applied import, with the summary and the items before and after", async () => {
    const app = await adminApp();
    await newCategory(app, { id: "old", title: "Old" });
    const count = await auditCount(app);
    await importFile(app, FILE);
    expect(await auditCount(app)).toBe(count + 1);
    const [entry] = await history(app);
    expect(entry).toMatchObject({
      actor: { id: "ada" },
      action: "import",
      object: { type: "catalog", id: null, label: null, exists: false },
      before: { categories: { old: { title: "Old", position: 0 } }, links: {} },
      after: { categories: { tools: { title: "Tools", position: 0 } }, links: { mail: { title: "Mail", categoryId: "tools", groups: ["local:Ops"] } } },
      details: {
        added: { categories: ["tools"], links: ["mail"] },
        updated: { categories: [], links: [] },
        removed: { categories: ["old"], links: [] },
        groupsCreated: ["local:Ops"],
      },
    });
    expect(entry!.details).not.toHaveProperty("warnings");
    expect(entry!.details).not.toHaveProperty("truncated");

    await importFile(app, FILE);
    expect(await auditCount(app)).toBe(count + 1);
  });

  it("writes no entry when the catalog changed since the preview", async () => {
    const app = await adminApp();
    const preview = await json<{ baseVersion: string }>(await post(app, "/api/admin/catalog", { yaml: FILE, dryRun: true }));
    await newCategory(app, { id: "other", title: "Other" });
    const count = await auditCount(app);
    const res = await post(app, "/api/admin/catalog", { yaml: FILE, dryRun: false, baseVersion: preview.baseVersion });
    expect((await errorOf(res)).code).toBe("catalog_changed");
    expect(await auditCount(app)).toBe(count);
  });

  it("keeps the summary only beyond 512 KiB of items", async () => {
    const app = await adminApp();
    const description = "x".repeat(500);
    const links = Array.from({ length: 1000 }, (_, i) => `      - id: l${i}\n        title: Link ${i}\n        url: https://example.org/${i}\n        description: ${description}\n        groups: ["@everyone"]\n`);
    await importFile(app, `version: 1\ncategories:\n  - id: big\n    title: Big\n    groups: ["@everyone"]\n    links:\n${links.join("")}`);
    const [entry] = await history(app);
    expect(entry).toMatchObject({ action: "import", before: null, after: null, details: { truncated: true } });
    expect((entry!.details!.added as { links: string[] }).links).toHaveLength(1000);
  });
});
