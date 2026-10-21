/**
 * Target policy cases shared by the policy tests and the outbound implementations (#63, #24).
 * `expected` is the result of `checkTarget`: an error code, or the normalised host and literal of an accepted URL.
 */
export type PolicyCase = {
  url: string;
  expected:
    | { ok: false; code: "blocked_address" | "blocked_port" | "invalid_target" }
    | { ok: true; host: string; literal: string | null };
};

const blocked = (url: string): PolicyCase => ({ url, expected: { ok: false, code: "blocked_address" } });
const badPort = (url: string): PolicyCase => ({ url, expected: { ok: false, code: "blocked_port" } });
const invalid = (url: string): PolicyCase => ({ url, expected: { ok: false, code: "invalid_target" } });

export const POLICY_CASES: readonly PolicyCase[] = [
  // IPv4 written in decimal, hexadecimal or octal, normalised by `new URL`.
  blocked("http://2130706433/"),
  blocked("http://0x7f.1/"),
  blocked("http://017700000001/"),
  blocked("http://0/"),
  // IPv6 literals, including IPv4-mapped, IPv4-compatible and NAT64 forms.
  blocked("http://[::]/"),
  blocked("http://[::ffff:127.0.0.1]/"),
  blocked("http://[::127.0.0.1]/"),
  blocked("http://[::7f00:1]/"),
  blocked("http://[64:ff9b::a00:1]/"),
  blocked("http://[64:ff9b:1::a00:1]/"),
  blocked("http://100.64.0.1/"),
  blocked("http://169.254.169.254/"),
  // Reserved names.
  blocked("http://localhost/"),
  blocked("http://localhost./"),
  blocked("http://localhost../"),
  blocked("http://LOCALHOST/"),
  blocked("http://foo.localhost/"),
  blocked("http://nas.local/"),
  blocked("http://nas.local../"),
  blocked("http://x.internal/"),
  blocked("http://r.home.arpa/"),
  // Malformed targets.
  invalid("http://user:pass@example.com/"),
  invalid("ftp://example.com/"),
  invalid("not a url"),
  // Fetch "bad ports".
  badPort("http://example.com:22/"),
  badPort("http://example.com:6379/"),
  // Accepted targets.
  { url: "https://example.com/", expected: { ok: true, host: "example.com", literal: null } },
  { url: "https://Example.COM./x", expected: { ok: true, host: "example.com", literal: null } },
  { url: "http://93.184.215.14/", expected: { ok: true, host: "93.184.215.14", literal: "93.184.215.14" } },
];

/** One address per refused range of the spec, IPv4 and IPv6. */
export const NON_PUBLIC_ADDRESSES: readonly string[] = [
  "0.1.2.3",
  "10.0.0.1",
  "100.64.0.1",
  "127.0.0.1",
  "169.254.169.254",
  "172.16.0.1",
  "192.0.0.1",
  "192.0.2.1",
  "192.88.99.1",
  "192.168.1.1",
  "198.18.0.1",
  "198.51.100.1",
  "203.0.113.1",
  "224.0.0.1",
  "240.0.0.1",
  "255.255.255.255",
  "::",
  "::1",
  "::7f00:1",
  "::a00:1",
  "fc00::1",
  "fd12:3456::1",
  "fe80::1",
  "fec0::1",
  "ff02::1",
  "::ffff:127.0.0.1",
  "::ffff:10.0.0.1",
  "64:ff9b::a00:1",
  "64:ff9b:1::a00:1",
  "2002:c000:0204::1",
  "2001::1",
  "2001:db8::1",
  "3fff::1",
  "100::1",
];

export const PUBLIC_ADDRESSES: readonly string[] = ["8.8.8.8", "2606:4700:4700::1111"];
