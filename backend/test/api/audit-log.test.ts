import { testApp } from "#harness";
import { describe, expect, it } from "vitest";

import { auditCount, history, historyPage, oldEntry } from "./audit";
import { adminApp, newCategory } from "./catalog-items";
import { addUser, post, send, signIn } from "./users";

const DAY = 86_400_000;

describe("history: access", () => {
  it("is refused without a session, to non-admins and with a temporary password", async () => {
    const app = await testApp();
    for (const path of ["/api/admin/history", "/api/admin/history/actors"]) expect((await app.request(path)).status).toBe(401);
    await addUser(app, { id: "bob", email: "bob@example.invalid" });
    await signIn(app, "bob@example.invalid");
    for (const path of ["/api/admin/history", "/api/admin/history/actors"]) expect((await app.request(path)).status).toBe(403);

    const temporary = await testApp();
    await addUser(temporary, { id: "ada", email: "ada@example.invalid", role: "admin", mustChangePassword: true });
    await signIn(temporary, "ada@example.invalid");
    const res = await temporary.request("/api/admin/history");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("password_change_required");
  });

  it("is not cached, and offers no way to change or delete an entry", async () => {
    const app = await adminApp();
    await newCategory(app, { title: "Tools" });
    for (const path of ["/api/admin/history", "/api/admin/history/actors"]) {
      expect((await app.request(path)).headers.get("cache-control")).toBe("no-store");
    }
    const [entry] = await history(app);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      for (const path of ["/api/admin/history", `/api/admin/history/${entry!.id}`]) expect((await send(app, method, path)).status).toBe(404);
    }
    expect(await auditCount(app)).toBe(1);
  });
});

describe("history: storage", () => {
  it("refuses to update an entry, or to delete one younger than 30 days, in SQL", async () => {
    const app = await adminApp();
    await newCategory(app, { title: "Tools" });
    await expect(app.exec("update audit_log set object_label = 'Forged'")).rejects.toThrow(/append-only/);
    await expect(app.exec("delete from audit_log")).rejects.toThrow(/30 days/);
    await oldEntry(app, 29);
    await expect(app.exec("delete from audit_log where object_id is null")).rejects.toThrow(/30 days/);
    expect(await auditCount(app)).toBe(2);

    await oldEntry(app, 31);
    await app.exec(`delete from audit_log where at < ${Date.now() - 30 * DAY}`);
    expect(await auditCount(app)).toBe(2);
  });

  it("rolls back a whole batch when a trigger or a guard refuses one statement", async () => {
    const app = await adminApp();
    await newCategory(app, { title: "Tools" });
    await expect(
      app.batch(["insert into setting (key, value) values ('probe', 'x')", "update audit_log set object_label = 'Forged'"]),
    ).rejects.toThrow();
    // The guard of audit.ts: a null value into a NOT NULL column, inserted only when the condition holds.
    await expect(
      app.batch(["insert into setting (key, value) values ('probe', 'x')", "insert into setting (key, value, updated_at) select 'audit.guard', null, 0 where 1"]),
    ).rejects.toThrow();
    expect(await app.query("select key from setting where key in ('probe', 'audit.guard')")).toEqual([]);
    await app.batch(["insert into setting (key, value) values ('probe', 'x')", "insert into setting (key, value, updated_at) select 'audit.guard', null, 0 where 0"]);
    expect(await app.query("select key from setting where key in ('probe', 'audit.guard')")).toEqual([{ key: "probe" }]);
  });
});

describe("history: retention", () => {
  it("hides expired entries at once and purges at most 100 of them with each action", async () => {
    const app = await adminApp();
    for (let i = 0; i < 150; i++) await oldEntry(app, 400);
    await oldEntry(app, 200);
    expect(await history(app)).toHaveLength(1);

    await newCategory(app, { title: "Tools" });
    expect(await auditCount(app)).toBe(150 - 100 + 1 + 1);
    await newCategory(app, { title: "Docs" });
    expect(await auditCount(app)).toBe(1 + 2);
    expect((await history(app)).map((e) => e.object.label)).toEqual(["Docs", "Tools", null]);
  });

  it("follows AUDIT_RETENTION_DAYS", async () => {
    const app = await adminApp({ AUDIT_RETENTION_DAYS: "30" });
    await oldEntry(app, 31);
    await oldEntry(app, 20);
    expect(await history(app)).toHaveLength(1);
    await newCategory(app, { title: "Tools" });
    expect(await auditCount(app)).toBe(2);
  });
});

describe("history: reading", () => {
  it("names the actor and the object, and says whether they still exist", async () => {
    const app = await adminApp();
    await addUser(app, { id: "bob", email: "bob@example.invalid", role: "admin" });
    const bob = app.another();
    await signIn(bob, "bob@example.invalid");
    const tools = await newCategory(bob, { title: "Tools" });
    expect((await send(app, "DELETE", "/api/admin/users/bob")).status).toBe(204);
    expect((await send(app, "DELETE", `/api/admin/categories/${tools.id}`, { revision: tools.revision, linkCount: 0 })).status).toBe(204);

    const [deleted, created] = await history(app, "type=category");
    expect(created).toMatchObject({
      actor: { id: "bob", name: "bob", email: "bob@example.invalid", exists: false },
      action: "create",
      object: { type: "category", id: "tools", label: "Tools", exists: false },
      related: null,
    });
    expect(deleted).toMatchObject({ actor: { id: "ada", exists: true }, action: "delete" });
    expect(new Date(created!.at).getTime()).toBeGreaterThan(Date.now() - 60_000);

    const actors = ((await (await app.request("/api/admin/history/actors")).json()) as { actors: unknown[] }).actors;
    expect(actors).toEqual([
      { id: "ada", name: "ada", email: "ada@example.invalid", exists: true },
      { id: "bob", name: "bob", email: "bob@example.invalid", exists: false },
    ]);
  });

  it("filters by actor, type, object and period", async () => {
    const app = await adminApp();
    await newCategory(app, { title: "Tools" });
    await oldEntry(app, 10, { actor: "gone", type: "link", object: "mail" });
    await oldEntry(app, 5, { type: "catalog" });
    await addUser(app, { id: "bob", email: "bob@example.invalid" });
    const group = ((await (await post(app, "/api/admin/groups", { name: "Ops" })).json()) as { group: { id: string } }).group;
    await send(app, "PUT", `/api/admin/groups/${group.id}/members/bob`);

    const labels = async (query: string) => (await history(app, query)).map((e) => `${e.action}:${e.object.type}`);
    expect(await labels("actor=ada")).toEqual(["member_add:group", "create:group", "create:category"]);
    expect(await labels("actor=gone")).toEqual(["update:link"]);
    expect(await labels("actor=none")).toEqual(["update:catalog"]);
    expect(await labels("type=link")).toEqual(["update:link"]);
    expect(await labels("object=bob")).toEqual(["member_add:group"]);
    expect(await labels(`object=${group.id}`)).toEqual(["member_add:group", "create:group"]);
    const iso = (days: number) => encodeURIComponent(new Date(Date.now() - days * DAY).toISOString());
    expect(await labels(`from=${iso(11)}&to=${iso(4)}`)).toEqual(["update:catalog", "update:link"]);
    expect(await labels(`from=${iso(1)}&type=category`)).toEqual(["create:category"]);
    expect(await labels(`to=${iso(7)}`)).toEqual(["update:link"]);
  });

  it("pages by cursor, without repeating or skipping an entry while others are written", async () => {
    const app = await adminApp();
    for (const title of ["A", "B", "C", "D", "E"]) await newCategory(app, { title });
    const first = await historyPage(app, "limit=2");
    expect(first.entries.map((e) => e.object.label)).toEqual(["E", "D"]);
    await newCategory(app, { title: "F" });
    const second = await historyPage(app, `limit=2&before=${first.next}`);
    expect(second.entries.map((e) => e.object.label)).toEqual(["C", "B"]);
    const third = await historyPage(app, `limit=2&before=${second.next}`);
    expect(third).toMatchObject({ entries: [{ object: { label: "A" } }], next: null });
    expect((await historyPage(app)).entries).toHaveLength(6);
  });

  it("refuses invalid filters with a code per field", async () => {
    const app = await adminApp();
    const res = await app.request("/api/admin/history?type=session&from=yesterday&to=2026-13-45&before=-3&limit=101");
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: unknown }).error).toMatchObject({
      code: "invalid_input",
      fields: { type: "invalid_type", from: "invalid_date", to: "invalid_date", before: "invalid_cursor", limit: "invalid_limit" },
    });
    for (const query of ["limit=0", "limit=abc", "before=abc"]) expect((await app.request(`/api/admin/history?${query}`)).status).toBe(422);
    expect((await app.request("/api/admin/history?limit=100&from=2026-01-01")).status).toBe(200);
  });
});
