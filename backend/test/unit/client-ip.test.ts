import { describe, expect, it } from "vitest";

import { forwardedClientIp } from "../../src/client-ip";

describe("forwardedClientIp", () => {
  it("takes the address appended by the proxy, not the one sent by the client", () => {
    expect(forwardedClientIp("6.6.6.6, 203.0.113.10")).toBe("203.0.113.10");
  });

  it("reads a single address", () => {
    expect(forwardedClientIp(" 203.0.113.10 ")).toBe("203.0.113.10");
  });

  it("returns null without a usable header", () => {
    expect(forwardedClientIp(undefined)).toBeNull();
    expect(forwardedClientIp(" , ")).toBeNull();
  });
});
