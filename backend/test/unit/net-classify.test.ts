import { describe, expect, it } from "vitest";

import { classify } from "../../src/net/classify";
import { OutboundError, type OutboundErrorCode, outboundHeaders, type OutboundResponse } from "../../src/net/outbound";

function response(status: number): OutboundResponse {
  return { status, headers: new Headers() };
}

describe("classify", () => {
  it.each([200, 204, 301, 302, 401, 403, 407, 429, 400, 418])("%i is up, with the status kept", (status) => {
    expect(classify(response(status))).toEqual({ state: "up", reason: null, httpStatus: status });
  });

  it.each([404, 410, 500, 502, 520, 530])("%i is down with http_error", (status) => {
    expect(classify(response(status))).toEqual({ state: "down", reason: "http_error", httpStatus: status });
  });

  it.each<[OutboundErrorCode, "down" | "unknown"]>([
    ["connect_failed", "down"],
    ["dns_not_found", "down"],
    ["timeout", "down"],
    ["tls_error", "down"],
    ["blocked_address", "unknown"],
    ["blocked_port", "unknown"],
    ["unsupported_on_target", "unknown"],
    ["resolver_failed", "unknown"],
  ])("%s is %s, without a status", (code, state) => {
    expect(classify(new OutboundError(code))).toEqual({ state, reason: code, httpStatus: null });
  });

  it.each<OutboundErrorCode>(["not_attempted", "too_large"])("%s writes nothing", (code) => {
    expect(classify(new OutboundError(code))).toBeNull();
  });
});

describe("OutboundError", () => {
  it("carries its code and is an Error", () => {
    const error = new OutboundError("timeout");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("timeout");
    expect(error.name).toBe("OutboundError");
  });
});

describe("outboundHeaders", () => {
  it("sends only the YASAD User-Agent and Accept", () => {
    const headers = outboundHeaders();
    expect(Object.keys(headers).sort()).toEqual(["Accept", "User-Agent"]);
    expect(headers["User-Agent"]).toMatch(/^YASAD-status\/\S+ \(\+https:\/\/github\.com\/TheIceMagmaCube\/yasad\)$/);
    expect(headers.Accept).toBe("*/*");
  });

  it("returns a fresh object each time", () => {
    const first = outboundHeaders();
    first.Cookie = "a=b";
    expect(outboundHeaders()).not.toHaveProperty("Cookie");
  });
});
