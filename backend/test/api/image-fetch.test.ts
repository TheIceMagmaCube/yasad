import { type TestApp, testApp } from "#harness";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_IMAGE_BYTES } from "../../src/images/limits";
import { DOH_ENDPOINT } from "../../src/net/doh";
import { type FakeNet, fakeNet, type SiteAnswer, targetRequests } from "../harness/fake-net";
import { concat, png, svg } from "../harness/images";
import { addUser, post, signIn } from "./users";

type FetchError = { code: string; reason?: string; status?: number; max?: number };

const PUBLIC_A = "93.184.215.14";
const PNG_TYPE = { "Content-Type": "image/png" };

let net: FakeNet;

beforeEach(() => {
  net = fakeNet();
  vi.stubGlobal("fetch", net.fetch);
});

afterEach(() => {
  expect(net.unexpected).toEqual([]);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A public name answering `answer` at https://<name>. */
function site(name: string, answer: SiteAnswer): string {
  net.dns[name] = { a: [PUBLIC_A] };
  net.sites[`https://${name}`] = answer;
  return `https://${name}/icon`;
}

async function adminApp(): Promise<TestApp> {
  const app = await testApp();
  await addUser(app, { id: "ada", email: "ada@example.invalid", role: "admin" });
  expect((await signIn(app, "ada@example.invalid")).status).toBe(200);
  return app;
}

const fetchImage = (app: TestApp, url: unknown) => post(app, "/api/admin/images/fetch", { url });
const errorOf = async (res: Response) => ((await res.json()) as { error: FetchError }).error;
const imageCount = async (app: TestApp) => (await app.query("select count(*) as n from image"))[0]!.n;
/** Requests other than DNS lookups: those that reached a site. */
const siteRequests = () => net.requests.filter((request) => !request.url.startsWith(DOH_ENDPOINT));

describe("POST /api/admin/images/fetch: access", () => {
  it("is refused without a session and to non-admins, before any request goes out", async () => {
    const url = site("icons.example", { status: 200, headers: PNG_TYPE, body: png() });
    const app = await testApp();
    const res = await fetchImage(app, url);
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe("unauthenticated");
    await addUser(app, { id: "bob", email: "bob@example.invalid" });
    expect((await signIn(app, "bob@example.invalid")).status).toBe(200);
    const forbidden = await fetchImage(app, url);
    expect(forbidden.status).toBe(403);
    expect((await errorOf(forbidden)).code).toBe("forbidden");
    expect(net.requests).toEqual([]);
  });
});

describe("POST /api/admin/images/fetch: success", () => {
  it("stores the image read from the bytes, whatever Content-Type says, as an upload would", async () => {
    const app = await adminApp();
    const res = await fetchImage(app, site("icons.example", { status: 200, headers: { "Content-Type": "text/html" }, body: png({ width: 32, height: 24 }) }));
    expect(res.status).toBe(201);
    const { image } = (await res.json()) as { image: { id: string; type: string; width: number; height: number; sanitized: boolean } };
    expect(image).toMatchObject({ type: "image/png", width: 32, height: 24, sanitized: false });
    const served = await app.request(`/api/images/${image.id}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
  });

  it("cleans a fetched SVG like an uploaded one", async () => {
    const app = await adminApp();
    const res = await fetchImage(app, site("icons.example", { status: 200, body: svg('<script>alert(1)</script><path d="M0 0h1"/>') }));
    expect(res.status).toBe(201);
    const { image } = (await res.json()) as { image: { id: string; sanitized: boolean } };
    expect(image.sanitized).toBe(true);
    expect(await (await app.request(`/api/images/${image.id}`)).text()).not.toContain("script");
  });

  it("follows up to three redirects, each to a public address", async () => {
    const app = await adminApp();
    site("a.example", { status: 302, headers: { Location: "https://b.example/" } });
    site("b.example", { status: 301, headers: { Location: "https://c.example/" } });
    site("c.example", { status: 307, headers: { Location: "https://d.example/" } });
    site("d.example", { status: 200, body: png() });
    expect((await fetchImage(app, "https://a.example/")).status).toBe(201);
    expect(targetRequests(net, "https://d.example")).toHaveLength(1);
  });

  it("sends no credentials nor origin headers, and announces itself", async () => {
    const app = await adminApp();
    const url = site("icons.example", { status: 200, body: png() });
    expect((await fetchImage(app, url)).status).toBe(201);
    const [request] = targetRequests(net, "https://icons.example");
    expect(request!.headers.get("user-agent")).toMatch(/^YASAD-icons\/\S+ \(\+https:\/\/github\.com\/TheIceMagmaCube\/yasad\)$/);
    expect(request!.headers.get("accept")).toBe("image/png, image/jpeg, image/webp, image/svg+xml");
    for (const name of ["cookie", "authorization", "referer", "origin", "x-forwarded-for", "cf-connecting-ip"]) {
      expect(request!.headers.has(name), name).toBe(false);
    }
  });
});

describe("POST /api/admin/images/fetch: refused addresses", () => {
  it.each([
    ["an IPv4 private address", { a: ["10.0.0.5"] }],
    ["the IPv4 loopback", { a: ["127.0.0.1"] }],
    ["the IPv6 loopback", { aaaa: ["::1"] }],
    ["a public and a private address", { a: [PUBLIC_A, "10.0.0.5"] }],
  ])("refuses a name that resolves to %s, without contacting it", async (_name, entry) => {
    const app = await adminApp();
    net.dns["inside.example"] = entry;
    const res = await fetchImage(app, "https://inside.example/icon.png");
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toMatchObject({ code: "image_fetch_refused", reason: "blocked_address" });
    expect(siteRequests()).toEqual([]);
    expect(await imageCount(app)).toBe(0);
  });

  it.each([
    ["the metadata address", "http://169.254.169.254/latest/meta-data/"],
    ["a name of the metadata address", "https://metadata.example/"],
  ])("refuses a redirect to %s, never contacting it", async (_name, location) => {
    const app = await adminApp();
    net.dns["metadata.example"] = { a: ["169.254.169.254"] };
    const url = site("icons.example", { status: 302, headers: { Location: location } });
    const res = await fetchImage(app, url);
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toMatchObject({ code: "image_fetch_refused", reason: "blocked_address" });
    expect(siteRequests().map((request) => request.url)).toEqual([url]);
  });

  it.each([
    ["a reserved name", "https://printer.local/icon.png", "blocked_address"],
    ["a bad port", "https://icons.example:6379/icon.png", "blocked_port"],
    ["a public IP literal (Workers cannot pin it)", `https://${PUBLIC_A}/icon.png`, "unsupported_on_target"],
    ["a scheme other than http and https", "ftp://icons.example/icon.png", "invalid_url"],
    ["credentials in the URL", "https://user:secret@icons.example/icon.png", "invalid_url"],
    ["text that is no URL", "icons.example/icon.png", "invalid_url"],
  ])("refuses %s", async (_name, url, reason) => {
    const app = await adminApp();
    const res = await fetchImage(app, url);
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toMatchObject({ code: "image_fetch_refused", reason });
    expect(net.requests).toEqual([]);
  });

  it("refuses a body without a URL", async () => {
    const app = await adminApp();
    const res = await fetchImage(app, 42);
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe("invalid_input");
    expect(net.requests).toEqual([]);
  });
});

describe("POST /api/admin/images/fetch: failures", () => {
  it("fails after more than three redirects", async () => {
    const app = await adminApp();
    for (const [from, to] of [["r1", "r2"], ["r2", "r3"], ["r3", "r4"], ["r4", "r5"]]) {
      site(`${from}.example`, { status: 302, headers: { Location: `https://${to}.example/` } });
    }
    site("r5.example", { status: 200, body: png() });
    const res = await fetchImage(app, "https://r1.example/");
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toMatchObject({ code: "image_fetch_failed", reason: "http_error", status: 302 });
    expect(targetRequests(net, "https://r5.example")).toEqual([]);
  });

  it("fails on a status other than 200, with the status", async () => {
    const app = await adminApp();
    const res = await fetchImage(app, site("icons.example", { status: 404, body: png() }));
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toMatchObject({ code: "image_fetch_failed", reason: "http_error", status: 404 });
    expect(await imageCount(app)).toBe(0);
  });

  it("refuses HTML served as image/png", async () => {
    const app = await adminApp();
    const res = await fetchImage(app, site("icons.example", { status: 200, headers: PNG_TYPE, body: "<!doctype html><title>x</title>" }));
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toMatchObject({ code: "invalid_image", reason: "unsupported_type" });
    expect(await imageCount(app)).toBe(0);
  });

  it("stops reading past the size limit", async () => {
    const app = await adminApp();
    const res = await fetchImage(app, site("icons.example", { status: 200, headers: PNG_TYPE, body: concat(png(), new Uint8Array(MAX_IMAGE_BYTES)) }));
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toEqual(expect.objectContaining({ code: "invalid_image", reason: "too_large", max: MAX_IMAGE_BYTES }));
  });

  it("gives up at the deadline", async () => {
    const app = await adminApp();
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    // The route's deadline is 10 s; shorten it so the test does not wait for it.
    const deadline = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => timeout(50));
    const res = await fetchImage(app, site("icons.example", "hang"));
    expect(deadline).toHaveBeenCalledWith(10_000);
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toMatchObject({ code: "image_fetch_failed", reason: "timeout" });
  });

  it.each<[string, SiteAnswer, string]>([
    ["a refused connection", "refused", "connect_failed"],
    ["a TLS error", "tls", "tls_error"],
  ])("fails on %s", async (_name, answer, reason) => {
    const app = await adminApp();
    const res = await fetchImage(app, site("icons.example", answer));
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toMatchObject({ code: "image_fetch_failed", reason });
  });

  it("fails on a name that does not exist", async () => {
    const app = await adminApp();
    net.dns["nowhere.example"] = { status: 3 };
    const res = await fetchImage(app, "https://nowhere.example/icon.png");
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toMatchObject({ code: "image_fetch_failed", reason: "dns_not_found" });
  });

  it("answers 503 when the platform refused the request, not a failure of the target", async () => {
    const app = await adminApp();
    const res = await fetchImage(app, site("icons.example", "platform"));
    expect(res.status).toBe(503);
    expect(await errorOf(res)).toMatchObject({ code: "image_fetch_failed", reason: "not_attempted" });
  });
});

describe("POST /api/admin/images/fetch: rate limit", () => {
  it("refuses the 31st fetch in 15 minutes with Retry-After, without calling out", async () => {
    const app = await adminApp();
    await app.exec(`insert into rate_limit (key, count, window_start) values ('image-fetch:ada', 29, ${Date.now()})`);
    const url = site("icons.example", { status: 404 });
    expect((await fetchImage(app, url)).status).toBe(422);
    const sent = net.requests.length;
    const res = await fetchImage(app, url);
    expect(res.status).toBe(429);
    expect((await errorOf(res)).code).toBe("rate_limited");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(net.requests.length).toBe(sent);
  });

  it("counts each admin apart", async () => {
    const app = await adminApp();
    await app.exec(`insert into rate_limit (key, count, window_start) values ('image-fetch:other', 30, ${Date.now()})`);
    expect((await fetchImage(app, site("icons.example", { status: 200, body: png() }))).status).toBe(201);
  });
});
