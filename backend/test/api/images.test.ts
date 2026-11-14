import { type TestApp, testApp } from "#harness";
import { describe, expect, it } from "vitest";

import {
  apng,
  iccp,
  includes,
  jpeg,
  jpegExif,
  jpegIcc,
  MALICIOUS_SVGS,
  png,
  pngChunk,
  svg,
  toBase64,
  webpExtended,
  WEBP_FLAGS,
  webpHeader,
  webpIcc,
  webpLossy,
  webpXmp,
} from "../harness/images";
import { addUser, post, signIn } from "./users";

type Image = { id: string; type: string; width: number; height: number; size: number; sanitized: boolean };

const IMAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox";
const DAY_MS = 24 * 60 * 60 * 1000;
const text = (s: string) => new TextEncoder().encode(s);

async function adminApp(): Promise<TestApp> {
  const app = await testApp();
  await addUser(app, { id: "ada", email: "ada@example.invalid", role: "admin" });
  expect((await signIn(app, "ada@example.invalid")).status).toBe(200);
  return app;
}

const upload = (app: TestApp, bytes: Uint8Array) => post(app, "/api/admin/images", { data: toBase64(bytes) });

async function uploaded(app: TestApp, bytes: Uint8Array): Promise<Image> {
  const res = await upload(app, bytes);
  expect(res.status).toBe(201);
  return ((await res.json()) as { image: Image }).image;
}

async function served(app: TestApp, id: string): Promise<Uint8Array> {
  const res = await app.request(`/api/images/${id}`);
  expect(res.status).toBe(200);
  return new Uint8Array(await res.arrayBuffer());
}

const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; reason?: string; max?: number } }).error;

/** Insert `count` images straight into the database, created at `createdAt`. */
async function fill(app: TestApp, count: number, createdAt: number) {
  await app.exec(`with recursive n(i) as (select 1 union all select i + 1 from n where i < ${count})
    insert into image (id, sha256, type, width, height, size, bytes, created_at)
    select lower(hex(randomblob(16))), lower(hex(randomblob(32))), 'image/png', 1, 1, 1, x'00', ${createdAt} from n`);
}

async function addImage(app: TestApp, id: string, createdAt: number) {
  await app.exec(`insert into image (id, sha256, type, width, height, size, bytes, created_at) values ('${id}', '${id}', 'image/png', 1, 1, 1, x'00', ${createdAt})`);
}

const ids = async (app: TestApp) => (await app.query("select id from image order by id")).map((r) => r.id);

describe("POST /api/admin/images: access", () => {
  it("is refused without a session and to non-admins", async () => {
    const app = await testApp();
    const res = await upload(app, png());
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe("unauthenticated");
    await addUser(app, { id: "bob", email: "bob@example.invalid" });
    expect((await signIn(app, "bob@example.invalid")).status).toBe(200);
    const forbidden = await upload(app, png());
    expect(forbidden.status).toBe(403);
    expect((await errorOf(forbidden)).code).toBe("forbidden");
    expect(await ids(app)).toEqual([]);
  });
});

describe("POST /api/admin/images: upload", () => {
  it("accepts PNG, JPEG, WebP and SVG with their size", async () => {
    const app = await adminApp();
    const cases = [
      { bytes: png({ width: 300, height: 120 }), type: "image/png", width: 300, height: 120 },
      { bytes: jpeg({ width: 64, height: 48, progressive: true }), type: "image/jpeg", width: 64, height: 48 },
      { bytes: webpLossy(100, 50), type: "image/webp", width: 100, height: 50 },
      { bytes: text(svg('<path d="M0 0h1"/>', 'viewBox="0 0 48 24"')), type: "image/svg+xml", width: 48, height: 24 },
    ];
    for (const { bytes, type, width, height } of cases) {
      const image = await uploaded(app, bytes);
      expect(image).toMatchObject({ type, width, height, sanitized: false });
      expect(image.id).toMatch(/^[0-9a-f]{32}$/);
      expect(Object.keys(image).sort()).toEqual(["height", "id", "sanitized", "size", "type", "width"]);
      expect(image.size).toBe((await served(app, image.id)).length);
    }
  });

  it("reads the type from the bytes, never from a name or a declared type", async () => {
    const app = await adminApp();
    const res = await app.request("/api/admin/images", { method: "POST", body: JSON.stringify({ data: toBase64(png()), type: "image/svg+xml", name: "logo.svg" }) });
    expect(((await res.json()) as { image: Image }).image.type).toBe("image/png");
    for (const bytes of [text("<!doctype html><html><body><script>alert(1)</script></body></html>"), text("<html><svg/></html>"), text("GIF89a")]) {
      const refused = await upload(app, bytes);
      expect(refused.status).toBe(422);
      expect(await errorOf(refused)).toMatchObject({ code: "invalid_image", reason: expect.stringMatching(/^(unsupported_type|svg_doctype)$/) });
    }
  });

  it("refuses an image over 256 KiB, over 2048 px, animated, cut short or not base64", async () => {
    const app = await adminApp();
    const big = png({ padding: 256 * 1024 });
    const cut = png();
    const cases: [Uint8Array | string, string, number?][] = [
      [big.subarray(0, 256 * 1024 + 1), "too_large", 256 * 1024],
      [png({ width: 2049, height: 10 }), "dimensions", 2048],
      [apng(), "animated"],
      [webpExtended({ flags: WEBP_FLAGS.animation }), "animated"],
      [cut.subarray(0, cut.length - 5), "unreadable"],
      ["not base64!", "unreadable"],
    ];
    for (const [bytes, reason, max] of cases) {
      const res = await post(app, "/api/admin/images", { data: typeof bytes === "string" ? bytes : toBase64(bytes) });
      expect(res.status).toBe(422);
      expect(await errorOf(res)).toEqual({ code: "invalid_image", message: expect.any(String), reason, ...(max ? { max } : {}) });
    }
    expect((await upload(app, png({ padding: 256 * 1024 - png().length }))).status).toBe(201);
    const missing = await post(app, "/api/admin/images", {});
    expect(missing.status).toBe(422);
    expect((await errorOf(missing)).code).toBe("invalid_input");
  });

  it("refuses a body over 360 KiB", async () => {
    const app = await adminApp();
    const res = await post(app, "/api/admin/images", { data: "A".repeat(360 * 1024) });
    expect(res.status).toBe(413);
    expect((await errorOf(res)).code).toBe("payload_too_large");
  });

  it("gives the same id to the same image sent twice", async () => {
    const app = await adminApp();
    const first = await uploaded(app, png());
    expect((await uploaded(app, png())).id).toBe(first.id);
    expect(await ids(app)).toEqual([first.id]);
    expect((await uploaded(app, png({ width: 17 }))).id).not.toBe(first.id);
  });

  it("serves a JPEG without Exif, a PNG without tEXt and a WebP without XMP, colour profiles kept", async () => {
    const app = await adminApp();
    const photo = await served(app, (await uploaded(app, jpeg({ extra: [jpegExif(), jpegIcc()] }))).id);
    expect(includes(photo, "GPSLatitude")).toBe(false);
    expect(includes(photo, "ICC_PROFILE")).toBe(true);
    const drawing = await served(app, (await uploaded(app, png({ before: [iccp(), pngChunk("tEXt", text("Author\0Jane Doe"))] }))).id);
    expect(includes(drawing, "Jane Doe")).toBe(false);
    expect(includes(drawing, "iCCP")).toBe(true);
    const flags = WEBP_FLAGS.icc | WEBP_FLAGS.xmp;
    const webp = await served(app, (await uploaded(app, webpExtended({ flags, chunks: [webpIcc(), webpXmp()] }))).id);
    expect(includes(webp, "xmpmeta")).toBe(false);
    expect(webpHeader(webp)).toEqual({ flags: WEBP_FLAGS.icc, riffSize: webp.length - 8 });
  });
});

describe("POST /api/admin/images: the image cap", () => {
  it("refuses a new image once 1000 are stored, but not one already stored", async () => {
    const app = await adminApp();
    const kept = await uploaded(app, png());
    await fill(app, 999, Date.now());
    const res = await upload(app, png({ width: 17 }));
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({ code: "images_full", message: expect.any(String), max: 1000 });
    expect((await uploaded(app, png())).id).toBe(kept.id);
    expect((await app.query("select count(*) as n from image"))[0]!.n).toBe(1000);
  });

  it("accepts an image when the database is full of orphans older than a day: the purge runs first", async () => {
    const app = await adminApp();
    await fill(app, 1000, Date.now() - DAY_MS - 60_000);
    expect((await upload(app, png())).status).toBe(201);
    expect((await app.query("select count(*) as n from image"))[0]!.n).toBe(901);
  });
});

describe("POST /api/admin/images: malicious SVG", () => {
  for (const { name, svg: source, absent, refused } of MALICIOUS_SVGS) {
    it(name, async () => {
      const app = await adminApp();
      const res = await upload(app, text(source));
      if (refused) {
        expect(res.status).toBe(422);
        expect(await errorOf(res)).toMatchObject({ code: "invalid_image", reason: refused });
        expect(await ids(app)).toEqual([]);
        return;
      }
      expect(res.status).toBe(201);
      const image = ((await res.json()) as { image: Image }).image;
      expect(image.sanitized).toBe(true);
      const stored = new TextDecoder().decode(await served(app, image.id));
      for (const fragment of absent!) expect(stored).not.toContain(fragment);
    });
  }
});

describe("GET /api/images/:id", () => {
  it("serves the image to anyone, with its type, nosniff, an immutable cache and the image CSP", async () => {
    const app = await adminApp();
    const { id } = await uploaded(app, text(svg('<path d="M0 0h1"/>')));
    const res = await app.another().request(`/api/images/${id}`, { headers: { origin: "" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("content-security-policy")).toBe(IMAGE_CSP);
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(await res.text()).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h1"/></svg>');
  });

  it("answers 404 without caching for an unknown or malformed id", async () => {
    const app = await testApp();
    for (const id of ["0123456789abcdef0123456789abcdef", "not-an-id", "0123456789ABCDEF0123456789ABCDEF"]) {
      const res = await app.request(`/api/images/${id}`);
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect((await errorOf(res)).code).toBe("not_found");
    }
  });

  it("keeps the app's CSP on other routes", async () => {
    const res = await (await testApp()).request("/api/instance");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it("answers a person with a temporary password, who is refused elsewhere", async () => {
    const admin = await adminApp();
    const { id } = await uploaded(admin, png());
    const tmp = admin.another();
    await addUser(tmp, { id: "tim", email: "tim@example.invalid", mustChangePassword: true });
    expect((await signIn(tmp, "tim@example.invalid")).status).toBe(200);
    expect((await tmp.request(`/api/images/${id}`)).status).toBe(200);
    const elsewhere = await tmp.request("/api/home");
    expect(elsewhere.status).toBe(403);
    expect((await errorOf(elsewhere)).code).toBe("password_change_required");
    const upload = await post(tmp, "/api/admin/images", { data: toBase64(png()) });
    expect(upload.status).toBe(403);
  });
});

describe("orphan purge", () => {
  it("removes an orphan older than a day at the next upload, and keeps cited or recent images", async () => {
    const app = await adminApp();
    const now = Date.now();
    const old = now - DAY_MS - 60_000;
    const [orphan, icon, logo, recent] = ["a", "b", "c", "d"].map((c) => c.repeat(32));
    for (const id of [orphan!, icon!, logo!]) await addImage(app, id, old);
    await addImage(app, recent!, now - DAY_MS + 60_000);
    await app.exec("insert into category (id, title, position) values ('tools', 'Tools', 0)");
    await app.exec(`insert into link (id, category_id, title, url, position, icon) values ('mail', 'tools', 'Mail', 'https://mail.example.org', 0, 'image:${icon}')`);
    await app.exec(`insert into setting (key, value) values ('instance.logo', 'image:${logo}')`);
    const { id } = await uploaded(app, png());
    expect(await ids(app)).toEqual([icon, logo, recent, id].sort());
  });

  it("purges at most 100 orphans per upload, the oldest first", async () => {
    const app = await adminApp();
    const old = Date.now() - 2 * DAY_MS;
    await fill(app, 120, old);
    await addImage(app, "e".repeat(32), old - 60_000);
    await uploaded(app, png());
    const left = await ids(app);
    expect(left).toHaveLength(22);
    expect(left).not.toContain("e".repeat(32));
  });

  it("gives an image sent again a new grace period", async () => {
    const app = await adminApp();
    const { id } = await uploaded(app, png());
    await app.exec(`update image set created_at = ${Date.now() - DAY_MS - 60_000}`);
    expect((await uploaded(app, png())).id).toBe(id);
    expect(Number((await app.query("select created_at from image"))[0]!.created_at)).toBeGreaterThan(Date.now() - 60_000);
  });
});
