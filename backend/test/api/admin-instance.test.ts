import { type TestApp, testApp } from "#harness";
import { describe, expect, it } from "vitest";

import { png, svg, toBase64 } from "../harness/images";
import { auditCount, history } from "./audit";
import { addUser, post, send, signIn } from "./users";

const DAY_MS = 24 * 60 * 60 * 1000;

type StoredImage = { id: string; type: string; width: number; height: number; size: number };

async function adminApp(): Promise<TestApp> {
  const app = await testApp();
  await addUser(app, { id: "ada", email: "ada@example.invalid", role: "admin" });
  expect((await signIn(app, "ada@example.invalid")).status).toBe(200);
  return app;
}

const patch = (app: TestApp, body: unknown) => send(app, "PATCH", "/api/admin/instance", body);
const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; fields?: Record<string, string> } }).error;
const publicInstance = async (app: TestApp) => (await (await app.request("/api/instance")).json()) as { title: string; logo: string | null; theme: string };
const settings = async (app: TestApp) =>
  Object.fromEntries((await app.query("select key, value from setting where key like 'instance.%' order by key")).map((r) => [r.key, r.value]));

async function uploaded(app: TestApp, bytes: Uint8Array): Promise<StoredImage> {
  const res = await post(app, "/api/admin/images", { data: toBase64(bytes) });
  expect(res.status).toBe(201);
  const { id, type, width, height, size } = ((await res.json()) as { image: StoredImage }).image;
  return { id, type, width, height, size };
}

async function addImage(app: TestApp, id: string, createdAt: number) {
  await app.exec(`insert into image (id, sha256, type, width, height, size, bytes, created_at) values ('${id}', '${id}', 'image/png', 1, 1, 1, x'00', ${createdAt})`);
}

const ids = async (app: TestApp) => (await app.query("select id from image order by id")).map((r) => r.id);

describe("/api/admin/instance: access", () => {
  it("is refused without a session and to non-admins, and writes nothing", async () => {
    const app = await testApp();
    for (const res of [await app.request("/api/admin/instance"), await patch(app, { title: "Mine" })]) {
      expect(res.status).toBe(401);
      expect((await errorOf(res)).code).toBe("unauthenticated");
    }
    await addUser(app, { id: "bob", email: "bob@example.invalid" });
    expect((await signIn(app, "bob@example.invalid")).status).toBe(200);
    for (const res of [await app.request("/api/admin/instance"), await patch(app, { title: "Mine" })]) {
      expect(res.status).toBe(403);
      expect((await errorOf(res)).code).toBe("forbidden");
    }
    expect(await settings(app)).toEqual({});
  });
});

describe("GET /api/admin/instance", () => {
  it("gives null for each default, uncached", async () => {
    const res = await (await adminApp()).request("/api/admin/instance");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ title: null, logo: null, theme: null });
  });

  it("gives a logo set outside the app as legacy, and still serves it", async () => {
    const app = await adminApp();
    await app.exec("insert into setting (key, value) values ('instance.logo', '/logo.svg'), ('instance.theme', 'neon')");
    expect(await (await app.request("/api/admin/instance")).json()).toEqual({ title: null, logo: { legacy: "/logo.svg" }, theme: null });
    expect((await publicInstance(app)).logo).toBe("/logo.svg");
    await app.exec("update setting set value = 'data:image/png;base64,AAAA' where key = 'instance.logo'");
    expect((await publicInstance(app)).logo).toBe("data:image/png;base64,AAAA");
  });
});

describe("PATCH /api/admin/instance", () => {
  it("stores the title, logo and theme, read back by everyone, and null goes back to the default", async () => {
    const app = await adminApp();
    const logo = await uploaded(app, new TextEncoder().encode(svg(`<circle cx="12" cy="12" r="8"/>`)));
    const res = await patch(app, { title: "  Home lab  ", logo: logo.id, theme: "dusk" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ title: "Home lab", logo, theme: "dusk" });
    expect(await settings(app)).toEqual({ "instance.logo": `image:${logo.id}`, "instance.theme": "dusk", "instance.title": "Home lab" });
    const visitor = app.another();
    expect(await publicInstance(visitor)).toMatchObject({ title: "Home lab", logo: `/api/images/${logo.id}`, theme: "dusk" });

    expect(await (await patch(app, { title: null })).json()).toEqual({ title: null, logo, theme: "dusk" });
    expect(await (await patch(app, { logo: null, theme: null })).json()).toEqual({ title: null, logo: null, theme: null });
    expect(await settings(app)).toEqual({});
    expect(await publicInstance(visitor)).toMatchObject({ title: "YASAD", logo: null, theme: "default" });
  });

  it("refuses values it cannot store, field by field, and writes nothing", async () => {
    const app = await adminApp();
    const res = await patch(app, { title: "   ", logo: "/logo.svg", theme: "neon" });
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toMatchObject({ code: "invalid_input", fields: { title: "invalid_title", logo: "invalid_logo", theme: "invalid_theme" } });
    const long = await patch(app, { title: "x".repeat(61) });
    expect((await errorOf(long)).fields).toEqual({ title: "invalid_title" });
    expect((await patch(app, { title: "x".repeat(60) })).status).toBe(200);
    for (const body of [{ title: 12 }, { logo: `image:${"a".repeat(32)}` }, { logo: "A".repeat(32) }, { theme: 1 }]) {
      expect((await patch(app, body)).status).toBe(422);
    }
    expect(await settings(app)).toEqual({ "instance.title": "x".repeat(60) });
  });

  it("refuses an image that is not stored, or no longer, and writes nothing", async () => {
    const app = await adminApp();
    expect((await patch(app, { title: "Before" })).status).toBe(200);
    const entries = await auditCount(app);
    const res = await patch(app, { title: "After", logo: "f".repeat(32) });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe("unknown_image");
    expect(await settings(app)).toEqual({ "instance.title": "Before" });
    expect(await auditCount(app)).toBe(entries);
  });

  it("keeps an image uploaded over a day ago that the save cites, and purges the other orphans", async () => {
    const app = await adminApp();
    const old = Date.now() - DAY_MS - 60_000;
    const [logo, orphan] = ["a".repeat(32), "b".repeat(32)];
    await addImage(app, logo, old);
    await addImage(app, orphan, old);
    expect((await patch(app, { logo })).status).toBe(200);
    expect(await ids(app)).toEqual([logo]);
    // Replaced, the former logo is cited by nothing and over a day old: the same save purges it.
    const next = await uploaded(app, png());
    expect((await patch(app, { logo: next.id })).status).toBe(200);
    expect(await ids(app)).toEqual([next.id]);
  });

  it("logs one entry per save that changes something, with a fixed label and the image reference", async () => {
    const app = await adminApp();
    const logo = await uploaded(app, new TextEncoder().encode(svg(`<circle cx="12" cy="12" r="8"/>`)));
    expect(await auditCount(app)).toBe(0);
    await patch(app, { title: "Home lab", logo: logo.id });
    await patch(app, { title: "Home lab", logo: logo.id });
    await patch(app, {});
    expect(await auditCount(app)).toBe(1);
    await patch(app, { title: null, theme: "dusk" });
    const [second, first] = await history(app, "type=instance");
    expect(first).toMatchObject({
      actor: { id: "ada" },
      action: "update",
      object: { type: "instance", id: null, label: null, exists: true },
      before: { title: null, logo: null, theme: null },
      after: { title: "Home lab", logo: `image:${logo.id}`, theme: null },
    });
    expect(second).toMatchObject({ before: { title: "Home lab", theme: null }, after: { title: null, logo: `image:${logo.id}`, theme: "dusk" }, object: { label: null } });
    expect(await auditCount(app)).toBe(2);
  });
});

describe("GET /api/instance/icon", () => {
  it("redirects to the logo, uncached, and to the YASAD logo without one", async () => {
    const app = await adminApp();
    const visitor = app.another();
    const fallback = await visitor.request("/api/instance/icon", { redirect: "manual" });
    expect(fallback.status).toBe(302);
    expect(fallback.headers.get("location")).toBe("/favicon.svg");
    expect(fallback.headers.get("cache-control")).toBe("no-cache");
    const logo = await uploaded(app, png());
    await patch(app, { logo: logo.id });
    const res = await visitor.request("/api/instance/icon", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/api/images/${logo.id}`);
  });

  it("follows a logo set outside the app, except a data: URI", async () => {
    const app = await testApp();
    await app.exec("insert into setting (key, value) values ('instance.logo', '/logo.svg')");
    expect((await app.request("/api/instance/icon", { redirect: "manual" })).headers.get("location")).toBe("/logo.svg");
    await app.exec("update setting set value = 'data:image/svg+xml,<svg/>' where key = 'instance.logo'");
    expect((await app.request("/api/instance/icon", { redirect: "manual" })).headers.get("location")).toBe("/favicon.svg");
  });

  it("answers a person with a temporary password", async () => {
    const app = await testApp();
    await addUser(app, { id: "tim", email: "tim@example.invalid", mustChangePassword: true });
    expect((await signIn(app, "tim@example.invalid")).status).toBe(200);
    expect((await app.request("/api/instance/icon", { redirect: "manual" })).status).toBe(302);
    const elsewhere = await app.request("/api/admin/instance");
    expect(elsewhere.status).toBe(403);
    expect((await errorOf(elsewhere)).code).toBe("password_change_required");
  });
});
