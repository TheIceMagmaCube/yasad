import { describe, expect, it } from "vitest";

import { forwardedClientIp } from "../../src/client-ip";

describe("forwardedClientIp", () => {
  it("takes the address appended by the proxy, not the one sent by the client", () => {
    expect(forwardedClientIp("6.6.6.6, 203.0.113.10", 1)).toBe("203.0.113.10");
  });

  it("skips the addresses appended by the proxies in front of the last one", () => {
    // Forged entry, client address appended by Cloudflare, Cloudflare address appended by the reverse proxy.
    expect(forwardedClientIp("6.6.6.6, 203.0.113.10, 104.16.0.1", 2)).toBe("203.0.113.10");
  });

  it("reads a single address", () => {
    expect(forwardedClientIp(" 203.0.113.10 ", 1)).toBe("203.0.113.10");
  });

  it("returns null without enough entries", () => {
    expect(forwardedClientIp(undefined, 1)).toBeNull();
    expect(forwardedClientIp(" , ", 1)).toBeNull();
    expect(forwardedClientIp("104.16.0.1", 2)).toBeNull();
  });
});
