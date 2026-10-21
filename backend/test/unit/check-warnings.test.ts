import { describe, expect, it } from "vitest";

import { checkWarnings } from "../../src/catalog/edit";

describe("checkWarnings", () => {
  it("says nothing about a link that is not checked", () => {
    expect(checkWarnings("http://10.0.0.5", false)).toEqual([]);
  });

  it.each([
    ["http://10.0.0.5/", "check_blocked_address"],
    ["http://127.0.0.1:8080", "check_blocked_address"],
    ["http://[::1]/", "check_blocked_address"],
    ["http://localhost/", "check_blocked_address"],
    ["https://nas.local", "check_blocked_address"],
    ["https://app.internal", "check_blocked_address"],
    ["https://user:pass@example.org", "check_blocked_address"],
    ["https://203.0.113.10", "check_blocked_address"],
    ["https://example.org:6379", "check_blocked_port"],
    ["http://example.org:22", "check_blocked_port"],
    ["https://acme.okta.com/home/x", "check_login_gateway"],
    ["https://ACME.oktapreview.com", "check_login_gateway"],
    ["https://acme.okta-emea.com", "check_login_gateway"],
    ["https://acme.okta.com./home", "check_login_gateway"],
    // One warning per link, in the order checkTarget decides: reserved name, then port, then IP literal.
    ["http://localhost:22", "check_blocked_address"],
    ["http://10.0.0.5:22", "check_blocked_port"],
  ])("warns about %s", (url, warning) => {
    expect(checkWarnings(url, true)).toEqual([warning]);
  });

  it.each(["https://okta.com", "https://okta.com.example.org", "https://notokta.com", "https://grafana.example.org", "https://93.184.215.14"])(
    "says nothing about %s",
    (url) => {
      expect(checkWarnings(url, true)).toEqual([]);
    },
  );
});
