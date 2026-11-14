import { type TestApp } from "#harness";
import { describe, expect, it } from "vitest";

import { png, toBase64 } from "../harness/images";
import { adminApp, adminCatalog, errorOf, importFile, type Link, newCategory, newLink } from "./catalog-items";
import { catalog, join, localUser } from "./home-catalog";
import { post, send } from "./users";

const DAY_MS = 24 * 60 * 60 * 1000;
const MISSING = "0123456789abcdef0123456789abcdef";

type HomeBody = { categories: { links: { id: string; icon: { set: string; name: string } | null }[] }[] };

/** Upload an image and return its id. */
async function upload(app: TestApp, width = 16): Promise<string> {
  const res = await post(app, "/api/admin/images", { data: toBase64(png({ width })) });
  expect(res.status).toBe(201);
  return ((await res.json()) as { image: { id: string } }).image.id;
}

/** Make every stored image older than the purge's grace period. */
const age = (app: TestApp) => app.exec(`update image set created_at = ${Date.now() - DAY_MS - 60_000}`);
const imageIds = async (app: TestApp) => (await app.query("select id from image order by id")).map((r) => r.id as string);

async function homeIcons(app: TestApp) {
  const res = await app.request("/api/home");
  const text = await res.text();
  const body = JSON.parse(text) as HomeBody;
  return { text, icons: Object.fromEntries(body.categories.flatMap((c) => c.links.map((l) => [l.id, l.icon]))) };
}

const linkOf = async (res: Response) => ((await res.json()) as { link: Link; warnings: string[] });

describe("link icons: an uploaded image", () => {
  it("is cited as image:<id>, known to the admin and drawn from /api/images on the home page", async () => {
    const admin = await adminApp();
    const id = await upload(admin);
    await newCategory(admin, { id: "tools", title: "Tools" });
    const res = await post(admin, "/api/admin/links", { id: "wiki", title: "Wiki", url: "https://example.org", categoryId: "tools", groups: ["@everyone"], icon: `image:${id}` });
    expect(res.status).toBe(201);
    const { link, warnings } = await linkOf(res);
    expect(link).toMatchObject({ icon: `image:${id}`, iconKnown: true });
    expect(warnings).not.toContain("unknown_icon");
    expect((await homeIcons(admin.another())).icons).toEqual({ wiki: { set: "image", name: id } });
  });

  it("refuses a link citing an image that is not stored, and writes nothing", async () => {
    const admin = await adminApp();
    await newCategory(admin, { id: "tools", title: "Tools" });
    const res = await post(admin, "/api/admin/links", { id: "wiki", title: "Wiki", url: "https://example.org", categoryId: "tools", groups: ["@everyone"], icon: `image:${MISSING}` });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe("unknown_image");
    expect(await admin.query("select id from link")).toEqual([]);
    expect(await admin.query("select id from audit_log where object_type = 'link'")).toEqual([]);
  });

  it("refuses a change citing an image purged meanwhile, and writes nothing", async () => {
    const admin = await adminApp();
    const id = await upload(admin);
    await newCategory(admin, { id: "tools", title: "Tools" });
    const link = await newLink(admin, { id: "wiki", title: "Wiki", categoryId: "tools" });
    // Uploaded, then purged before the save that cites it: aged, and another upload runs the purge.
    await age(admin);
    await upload(admin, 32);
    expect(await imageIds(admin)).not.toContain(id);
    const res = await send(admin, "PATCH", "/api/admin/links/wiki", { revision: link.revision, icon: `image:${id}`, title: "Renamed" });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe("unknown_image");
    expect(await admin.query("select title, icon, revision from link")).toEqual([{ title: "Wiki", icon: null, revision: link.revision }]);
  });

  it("refuses a malformed image reference as an invalid icon", async () => {
    const admin = await adminApp();
    await newCategory(admin, { id: "tools", title: "Tools" });
    for (const icon of [`image:${MISSING.toUpperCase()}`, "image:42", `image:${MISSING}0`]) {
      const res = await post(admin, "/api/admin/links", { id: "wiki", title: "Wiki", url: "https://example.org", categoryId: "tools", groups: ["@everyone"], icon });
      expect(res.status, icon).toBe(422);
      expect((await errorOf(res)).fields).toEqual({ icon: "invalid_icon" });
    }
  });

  it("is reported unknown to the admin once the image is gone", async () => {
    const admin = await adminApp();
    await importFile(admin, catalog([{ id: "tools", groups: ["@everyone"], links: [{ id: "wiki", groups: ["@everyone"], icon: `image:${MISSING}` }] }]));
    const [link] = (await adminCatalog(admin))[0]!.links;
    expect(link).toMatchObject({ icon: `image:${MISSING}`, iconKnown: false });
  });
});

describe("link icons: a hidden link", () => {
  it("never sends its image id to an anonymous visitor, whichever of the link or the category hides it", async () => {
    const admin = await adminApp();
    const [a, b] = [await upload(admin, 16), await upload(admin, 32)];
    await importFile(
      admin,
      catalog([
        { id: "public", groups: ["@everyone"], links: [{ id: "members", groups: ["@authenticated"], icon: `image:${a}` }] },
        { id: "private", groups: ["@authenticated"], links: [{ id: "open", groups: ["@everyone"], icon: `image:${b}` }] },
      ]),
    );
    const { text } = await homeIcons(admin.another());
    expect(text).not.toContain(a);
    expect(text).not.toContain(b);
    // The same links do reach a signed-in person: the test would pass for a reason other than visibility otherwise.
    expect(Object.keys((await homeIcons(admin)).icons).sort()).toEqual(["members", "open"]);
  });

  it("never sends its image id to a person holding only one of the two groups", async () => {
    const admin = await adminApp();
    for (const name of ["Ops", "Dev"]) expect((await post(admin, "/api/admin/groups", { name })).status).toBe(201);
    const id = await upload(admin);
    await importFile(admin, catalog([{ id: "tools", groups: ["local:Ops"], links: [{ id: "deploy", groups: ["local:Dev"], icon: `image:${id}` }] }]));
    const ops = await localUser(admin, "olga");
    await join(admin, "olga", "Ops");
    const dev = await localUser(admin, "dan");
    await join(admin, "dan", "Dev");
    for (const browser of [ops, dev]) expect((await homeIcons(browser)).text).not.toContain(id);
    await join(admin, "dan", "Ops");
    expect((await homeIcons(dev)).icons).toEqual({ deploy: { set: "image", name: id } });
  });
});

describe("link icons: the catalog file", () => {
  it("exports image:<id> and imports it back unchanged, without a warning", async () => {
    const admin = await adminApp();
    const id = await upload(admin);
    await newCategory(admin, { id: "tools", title: "Tools" });
    await newLink(admin, { id: "wiki", title: "Wiki", categoryId: "tools", icon: `image:${id}` });
    const yaml = await (await admin.request("/api/admin/catalog")).text();
    expect(yaml).toContain(`icon: image:${id}`);
    const res = await post(admin, "/api/admin/catalog", { yaml, dryRun: true });
    expect(res.status).toBe(200);
    const { diff } = (await res.json()) as { diff: { warnings: { code: string }[]; updated: { links: string[] } } };
    expect(diff.updated.links).toEqual([]);
    expect(diff.warnings).toEqual([]);
  });

  it("warns unknown_icon for an image this instance does not store, and keeps the reference", async () => {
    const admin = await adminApp();
    const known = await upload(admin);
    const yaml = catalog([
      {
        id: "tools",
        groups: ["@everyone"],
        links: [
          { id: "wiki", groups: ["@everyone"], icon: `image:${MISSING}` },
          { id: "mail", groups: ["@everyone"], icon: `image:${known}` },
        ],
      },
    ]);
    const res = await post(admin, "/api/admin/catalog", { yaml, dryRun: true });
    const { diff } = (await res.json()) as { diff: { warnings: { code: string; id: string }[] } };
    expect(diff.warnings).toEqual([{ code: "unknown_icon", kind: "link", id: "wiki" }]);
    await importFile(admin, yaml);
    expect(await admin.query("select id, icon from link order by id")).toEqual([
      { id: "mail", icon: `image:${known}` },
      { id: "wiki", icon: `image:${MISSING}` },
    ]);
  });
});

describe("link icons: orphan purge", () => {
  /** Return an admin with the links `wiki` and `mail` in `tools`, each citing its own image, both over a day old. */
  async function cited(admin?: TestApp) {
    admin ??= await adminApp();
    const [wikiImage, mailImage] = [await upload(admin, 16), await upload(admin, 32)];
    await newCategory(admin, { id: "tools", title: "Tools" });
    const wiki = await newLink(admin, { id: "wiki", title: "Wiki", categoryId: "tools", icon: `image:${wikiImage}` });
    await newLink(admin, { id: "mail", title: "Mail", categoryId: "tools", icon: `image:${mailImage}` });
    await age(admin);
    return { admin, wiki, wikiImage, mailImage };
  }

  it("removes the former image of a link whose icon changes, and keeps the images still cited", async () => {
    const { admin, wiki, wikiImage, mailImage } = await cited();
    const res = await send(admin, "PATCH", "/api/admin/links/wiki", { revision: wiki.revision, icon: "lucide:mail" });
    expect(res.status).toBe(200);
    expect(await imageIds(admin)).toEqual([mailImage]);
    expect(await imageIds(admin)).not.toContain(wikiImage);
  });

  it("runs no purge when a change leaves the icon alone", async () => {
    const admin = await adminApp();
    // An orphan past its grace period: only a purge would remove it, so it shows whether the change ran one.
    await upload(admin, 64);
    const { wiki } = await cited(admin);
    const before = await imageIds(admin);
    expect(before).toHaveLength(3);
    expect((await send(admin, "PATCH", "/api/admin/links/wiki", { revision: wiki.revision, title: "Renamed" })).status).toBe(200);
    expect(await imageIds(admin)).toEqual(before);
  });

  it("removes the image of a deleted link", async () => {
    const { admin, wiki, mailImage } = await cited();
    expect((await send(admin, "DELETE", "/api/admin/links/wiki", { revision: wiki.revision })).status).toBe(204);
    expect(await imageIds(admin)).toEqual([mailImage]);
  });

  it("removes the images of the links of a deleted category", async () => {
    const { admin } = await cited();
    const [tools] = await adminCatalog(admin);
    expect((await send(admin, "DELETE", "/api/admin/categories/tools", { revision: tools!.revision, linkCount: 2 })).status).toBe(204);
    expect(await imageIds(admin)).toEqual([]);
  });

  it("removes the image of a link an import removes, and keeps the one the file still cites", async () => {
    const { admin, mailImage } = await cited();
    await importFile(admin, catalog([{ id: "tools", groups: ["@everyone"], links: [{ id: "mail", groups: ["@everyone"], icon: `image:${mailImage}` }] }]));
    expect(await imageIds(admin)).toEqual([mailImage]);
  });
});
