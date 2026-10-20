import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { BAD_PORTS, checkTarget, isPublicAddress } from "../../src/net/policy";
import { NON_PUBLIC_ADDRESSES, POLICY_CASES, PUBLIC_ADDRESSES } from "./net-cases";

describe("checkTarget", () => {
  it.each(POLICY_CASES)("$url", ({ url, expected }) => {
    const result = checkTarget(url);
    if (expected.ok) {
      expect(result).toMatchObject({ ok: true, host: expected.host, literal: expected.literal });
    } else {
      expect(result).toEqual(expected);
    }
  });

  it("accepts a URL object and returns it parsed", () => {
    const result = checkTarget(new URL("https://example.com:8443/status"));
    expect(result.ok && result.url.href).toBe("https://example.com:8443/status");
  });

  it("checks the default port of the scheme when none is given", () => {
    expect(checkTarget("http://example.com/").ok).toBe(true);
    expect(checkTarget("http://example.com:0/")).toEqual({ ok: false, code: "blocked_port" });
  });
});

describe("BAD_PORTS", () => {
  it("holds the Fetch bad ports and Redis, and leaves the web ports out", () => {
    for (const port of [0, 1, 22, 25, 53, 6379, 6697, 10080]) expect(BAD_PORTS.has(port)).toBe(true);
    for (const port of [80, 443, 8080, 8443]) expect(BAD_PORTS.has(port)).toBe(false);
  });
});

describe("isPublicAddress", () => {
  it.each(NON_PUBLIC_ADDRESSES)("refuses %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each(PUBLIC_ADDRESSES)("accepts %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it("refuses input that is not an address", () => {
    expect(isPublicAddress("garbage")).toBe(false);
    expect(isPublicAddress("")).toBe(false);
  });
});

describe("ipaddr.js", () => {
  it("is at least 2.5, since earlier versions miss several refused ranges", async () => {
    const path = createRequire(import.meta.url).resolve("ipaddr.js/package.json");
    const { version } = JSON.parse(await readFile(path, "utf8")) as { version: string };
    const [major = 0, minor = 0] = version.split(".").map(Number);
    expect(major > 2 || (major === 2 && minor >= 5)).toBe(true);
  });
});
