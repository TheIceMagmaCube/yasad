import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { beforeEach, describe, expect, it } from "vitest";

import {
  applyEdit,
  type Author,
  createCategory,
  createLink,
  deleteCategory,
  deleteLink,
  idFromTitle,
  moveCategory,
  moveLink,
  parseBody,
  updateCategory,
  updateLink,
} from "../../src/catalog/edit";
import { linkSchema } from "../../src/catalog/format";
import { readCatalog } from "../../src/catalog/sync";
import type { DB } from "../../src/db";
import * as schema from "../../src/schema";

let client: Client;
let db: DB;

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  const database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder: "drizzle" });
  db = database as unknown as DB;
  await client.executeMultiple(`
    insert into "group" (id, name, source) values ('ops', 'Ops', 'local');
    insert into category (id, title, position) values ('tools', 'Tools', 0);
    insert into link (id, category_id, title, url, position) values ('wiki', 'tools', 'Wiki', 'https://wiki.example.org', 0);
  `);
});

/** Return the database, where `sql` runs just before the first batch: another admin's write landing in between. */
function racedBy(sql: string): DB {
  let raced = false;
  return new Proxy(db, {
    get(target, key) {
      if (key === "batch" && !raced) {
        return async (queries: readonly [unknown, ...unknown[]]) => {
          raced = true;
          await client.executeMultiple(sql);
          return target.batch(queries);
        };
      }
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** Return the database as the admin "ada" writes to it. */
const by = (db: DB): Author => ({ db, actorId: "ada", retentionDays: 365 });

const rows = async (sql: string) => (await client.execute(sql)).rows.map((row) => ({ ...row }));
const entries = async () => (await rows("select action, before, after from audit_log")).map((row) => ({
  action: row.action,
  before: JSON.parse(row.before as string) as unknown,
  after: JSON.parse(row.after as string) as unknown,
}));

describe("catalog edits racing another write", () => {
  it("refuses a change when the link changed between the check and the write", async () => {
    const raced = racedBy(`update link set title = 'Theirs', revision = 2 where id = 'wiki'`);
    const result = await applyEdit(by(raced), () => updateLink(by(raced), "wiki", { revision: 1, title: "Mine" }));
    expect(result).toMatchObject({ status: 409, code: "item_changed", details: { current: { title: "Theirs", revision: 2 } } });
    expect(await rows("select title, revision from link")).toEqual([{ title: "Theirs", revision: 2 }]);
    expect(await entries()).toEqual([]);
  });

  it("logs the state the edit changed when a group was renamed between the read and the write", async () => {
    await client.execute(`insert into link_group (link_id, group_id) values ('wiki', 'ops')`);
    const raced = racedBy(`update "group" set name = 'Run' where id = 'ops'`);
    const result = await applyEdit(by(raced), () => updateLink(by(raced), "wiki", { revision: 1, title: "Mine" }));
    expect(result).toMatchObject({ after: { title: "Mine", groups: ["local:Run"] } });
    expect(await entries()).toMatchObject([{ action: "update", before: { title: "Wiki", groups: ["local:Run"] }, after: { title: "Mine", groups: ["local:Run"] } }]);
  });

  it("answers not_found when the link was deleted between the check and the write", async () => {
    const raced = racedBy(`delete from link where id = 'wiki'`);
    const result = await applyEdit(by(raced), () => updateLink(by(raced), "wiki", { revision: 1, title: "Mine" }));
    expect(result).toMatchObject({ status: 404, code: "not_found" });
    expect(await rows("select id from link")).toEqual([]);
  });

  it("refuses to delete a link changed between the check and the write", async () => {
    const raced = racedBy(`update link set revision = 2 where id = 'wiki'`);
    const result = await applyEdit(by(raced), () => deleteLink(by(raced), "wiki", { revision: 1 }));
    expect(result).toMatchObject({ status: 409, code: "item_changed" });
    expect(await rows("select id from link")).toEqual([{ id: "wiki" }]);
  });

  it("refuses a local group deleted between the check and the write, instead of dropping it", async () => {
    const raced = racedBy(`delete from "group" where id = 'ops'`);
    const result = await applyEdit(by(raced), () => updateLink(by(raced), "wiki", { revision: 1, groups: ["local:Ops"] }));
    expect(result).toMatchObject({ status: 422, code: "invalid_input", details: { fields: { groups: "unknown_group" } } });
    expect(await rows("select revision from link")).toEqual([{ revision: 1 }]);
    expect(await entries()).toEqual([]);

    const again = racedBy(`delete from "group" where id = 'ops2'`);
    await client.execute(`insert into "group" (id, name, source) values ('ops2', 'Ops', 'local')`);
    const created = await applyEdit(by(again), () => createCategory(by(again), { title: "Ops tools", groups: ["local:Ops"] }));
    expect(created).toMatchObject({ status: 422, details: { fields: { groups: "unknown_group" } } });
    expect(await rows("select id from category")).toEqual([{ id: "tools" }]);
  });

  it("refuses to delete a category that gained a link since the confirmation", async () => {
    const raced = racedBy(`insert into link (id, category_id, title, url, position) values ('new', 'tools', 'New', 'https://new.example.org', 1)`);
    const result = await applyEdit(by(raced), () => deleteCategory(by(raced), "tools", { revision: 1, linkCount: 1 }));
    expect(result).toMatchObject({ status: 409, code: "item_changed", details: { linkCount: 2 } });
    expect(await rows("select id from link order by id")).toEqual([{ id: "new" }, { id: "wiki" }]);
    expect(await entries()).toEqual([]);
  });

  it("refuses to change a category changed between the check and the write", async () => {
    const raced = racedBy(`update category set revision = 2 where id = 'tools'`);
    const result = await applyEdit(by(raced), () => updateCategory(by(raced), "tools", { revision: 1, title: "Mine" }));
    expect(result).toMatchObject({ status: 409, code: "item_changed" });
    expect(await rows("select title from category")).toEqual([{ title: "Tools" }]);
  });

  it("refuses a category beyond the limit when another one was created meanwhile", async () => {
    const values = Array.from({ length: 198 }, (_, i) => `('c${i}', 'C${i}', ${i + 1})`).join(", ");
    await client.execute(`insert into category (id, title, position) values ${values}`);
    const raced = racedBy(`insert into category (id, title, position) values ('last', 'Last', 199)`);
    const result = await applyEdit(by(raced), () => createCategory(by(raced), { title: "Mine", groups: [] }));
    expect(result).toMatchObject({ status: 409, code: "catalog_full" });
    expect(await rows("select count(*) as n from category")).toEqual([{ n: 200 }]);
    expect(await entries()).toEqual([]);
  });

  it("takes the next free id when a derived one was taken meanwhile, and refuses a chosen one", async () => {
    const raced = racedBy(`insert into link (id, category_id, title, url, position) values ('docs', 'tools', 'Docs', 'https://d.example.org', 1)`);
    const body = { categoryId: "tools", title: "Docs", url: "https://docs.example.org", groups: [] };
    const derived = await applyEdit(by(raced), () => createLink(by(raced), body));
    expect(derived).toMatchObject({ after: { id: "docs-2" } });

    const again = racedBy(`insert into link (id, category_id, title, url, position) values ('mine', 'tools', 'Mine', 'https://m.example.org', 3)`);
    const chosen = await applyEdit(by(again), () => createLink(by(again), { ...body, id: "mine" }));
    expect(chosen).toMatchObject({ status: 422, details: { fields: { id: "id_taken" } } });
  });

  it("answers not_found when the moved link was deleted between the check and the write", async () => {
    await client.execute(`insert into link (id, category_id, title, url, position) values ('docs', 'tools', 'Docs', 'https://d.example.org', 1)`);
    const raced = racedBy(`delete from link where id = 'docs'`);
    const result = await applyEdit(by(raced), () => moveLink(by(raced), "docs", { direction: "up" }));
    expect(result).toMatchObject({ status: 404, code: "not_found" });
    expect(await rows("select value from setting where key = 'catalog.revision'")).toEqual([]);
  });

  it("answers item_changed when the moved link went to another category meanwhile", async () => {
    await client.executeMultiple(`
      insert into category (id, title, position) values ('other', 'Other', 1);
      insert into link (id, category_id, title, url, position) values ('docs', 'tools', 'Docs', 'https://d.example.org', 1);
    `);
    const raced = racedBy(`update link set category_id = 'other', position = 0, revision = 2 where id = 'docs'`);
    const result = await applyEdit(by(raced), () => moveLink(by(raced), "docs", { direction: "up" }));
    expect(result).toMatchObject({ status: 409, code: "item_changed", details: { current: { id: "docs", categoryId: "other", revision: 2 } } });
    expect(await rows("select id, position from link where category_id = 'tools'")).toEqual([{ id: "wiki", position: 0 }]);
  });

  it("answers not_found when the moved category was deleted between the check and the write", async () => {
    await client.execute(`insert into category (id, title, position) values ('other', 'Other', 1)`);
    const raced = racedBy(`delete from category where id = 'other'`);
    const result = await applyEdit(by(raced), () => moveCategory(by(raced), "other", { direction: "up" }));
    expect(result).toMatchObject({ status: 404, code: "not_found" });
    expect(await rows("select value from setting where key = 'catalog.revision'")).toEqual([]);
  });

  it("refuses a link in a category deleted meanwhile", async () => {
    await client.execute(`insert into category (id, title, position) values ('gone', 'Gone', 1)`);
    const raced = racedBy(`delete from category where id = 'gone'`);
    const result = await applyEdit(by(raced), () => createLink(by(raced), { categoryId: "gone", title: "X", url: "https://x.example.org", groups: [] }));
    expect(result).toMatchObject({ status: 422, details: { fields: { categoryId: "unknown_category" } } });
  });
});

describe("catalog edit helpers", () => {
  it("derives an id from a title", () => {
    expect(idFromTitle("Équipe Prod & Ops!", "x")).toBe("equipe-prod-ops");
    expect(idFromTitle("  --Ça marche--  ", "x")).toBe("ca-marche");
    expect(idFromTitle("日本", "lien")).toBe("lien");
    expect(idFromTitle(`${"a".repeat(63)} b`, "x")).toBe("a".repeat(63));
  });

  it("names each invalid field by its top-level name", () => {
    expect(parseBody(linkSchema, { id: "x", title: "T", url: "https://x.example.org", groups: ["@everyone", "bad"], keywords: ["ok", ""], extra: 1 })).toEqual({
      failure: { status: 422, code: "invalid_input", details: { fields: { groups: "invalid_group_ref", keywords: "required", extra: "unknown_field" } } },
    });
  });

  it("reads the catalog in (position, id) order", async () => {
    await client.executeMultiple(`
      insert into category (id, title, position) values ('alpha', 'Alpha', 0);
      insert into link (id, category_id, title, url, position) values ('aaa', 'tools', 'A', 'https://a.example.org', 0);
    `);
    const catalog = await readCatalog(db);
    expect(catalog.categories.map((cat) => cat.id)).toEqual(["alpha", "tools"]);
    expect(catalog.categories[1]!.links.map((lnk) => lnk.id)).toEqual(["aaa", "wiki"]);
  });
});
