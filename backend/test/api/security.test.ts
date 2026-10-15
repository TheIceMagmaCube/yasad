import { testApp } from "#harness";
import { describe, expect, it } from "vitest";

const CODE = "setup-code-for-the-tests-0123456789";

describe("security headers", () => {
  it("are sent on API responses", async () => {
    const res = await (await testApp()).request("/api/health");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
  });

  it("are sent on errors too", async () => {
    const res = await (await testApp({ AUTH_SECRET: "short" })).request("/api/health");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it("leave out HSTS on a plain http URL", async () => {
    const res = await (await testApp({ PUBLIC_URL: "http://localhost:5173" })).request("/api/health");
    expect(res.headers.get("strict-transport-security")).toBeNull();
  });
});

describe("cross-site requests", () => {
  const verify = (headers: HeadersInit, body = JSON.stringify({ code: CODE })) =>
    testApp({ SETUP_CODE: CODE }).then((app) => app.request("/api/setup/verify-code", { method: "POST", body, headers }));

  it("accepts a same-origin JSON request", async () => {
    expect((await verify({})).status).toBe(204);
  });

  it("accepts a request without Origin, as sent by non-browser clients", async () => {
    expect((await verify({ origin: "" })).status).toBe(204);
  });

  it("refuses another Origin", async () => {
    const res = await verify({ origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("cross_site_request");
  });

  it("refuses a request the browser marks as cross-site", async () => {
    expect((await verify({ "sec-fetch-site": "cross-site" })).status).toBe(403);
  });

  it("refuses a body that is not JSON", async () => {
    const res = await verify({ "content-type": "text/plain" });
    expect(res.status).toBe(415);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unsupported_media_type");
  });

  it("applies to Better Auth routes too, which only check Origin when a cookie is sent", async () => {
    const app = await testApp();
    const res = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email: "ada@example.invalid", password: "correct horse battery" }),
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("cross_site_request");
  });
});
