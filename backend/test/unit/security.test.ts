import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { CONTENT_SECURITY_POLICY, headersFile, IMAGE_CONTENT_SECURITY_POLICY, securityHeaders } from "../../src/security";

describe("frontend/public/_headers", () => {
  it("matches the headers sent by the app, so the Worker's static assets get them too", async () => {
    const file = await readFile(new URL("../../../frontend/public/_headers", import.meta.url), "utf8");
    expect(file).toBe(headersFile());
  });

  it("caches the icon files for a year, since their path changes with their content", () => {
    expect(headersFile()).toContain("/icons/*\n  Cache-Control: public, max-age=31536000, immutable\n");
  });
});

describe("securityHeaders", () => {
  it("gives stored images a CSP with no script, no external resource and a sandbox", () => {
    expect(IMAGE_CONTENT_SECURITY_POLICY).toBe("default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox");
    expect(securityHeaders(true, "/api/images/x")["Content-Security-Policy"]).toBe(IMAGE_CONTENT_SECURITY_POLICY);
    expect(securityHeaders(false, "/api/images/x")["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("keeps the app's CSP everywhere else, the static files included", () => {
    for (const path of ["", "/", "/api/home", "/api/imagesx", "/images/x"]) {
      expect(securityHeaders(true, path)["Content-Security-Policy"]).toBe(CONTENT_SECURITY_POLICY);
    }
    expect(headersFile()).not.toContain(IMAGE_CONTENT_SECURITY_POLICY);
  });
});
