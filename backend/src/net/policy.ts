import ipaddr from "ipaddr.js";

/** Result of `checkTarget`: the parsed URL with its normalised host, or the reason it is refused. */
export type TargetCheck =
  | { ok: true; url: URL; host: string; literal: string | null }
  | { ok: false; code: "blocked_address" | "blocked_port" | "invalid_target" };

/**
 * Ports refused on both targets (`node:http` does not filter them): the "bad ports" of the Fetch specification, plus
 * 6379 (Redis), which Fetch leaves out.
 */
export const BAD_PORTS: ReadonlySet<number> = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109,
  110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531,
  532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060,
  5061, 6000, 6379, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

const DEFAULT_PORTS: Readonly<Record<string, number>> = { "http:": 80, "https:": 443 };

/** IPv4-compatible addresses: ipaddr.js calls them unicast, but a translating stack reaches the IPv4 inside. */
const IPV4_COMPATIBLE = ipaddr.parseCIDR("::/96");

/** Names that only make sense on a local network. */
function isReservedName(host: string): boolean {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa")
  );
}

/**
 * True when `ip` is a global unicast address: `range()` of the processed address (IPv4-mapped unwrapped) is
 * `unicast`, and it is outside `::/96`. False for anything that does not parse as an address.
 */
export function isPublicAddress(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return false;
  const address = ipaddr.process(ip);
  if (address.range() !== "unicast") return false;
  return !(address.kind() === "ipv6" && address.match(IPV4_COMPATIBLE));
}

/**
 * Check an outbound target before any resolution: scheme, credentials, host name, port, then the address when the
 * host is an IP literal. The host is checked as `new URL` normalises it (numeric IPv4 forms expanded, IPv6 compressed),
 * without brackets or trailing dots, in lower case. A name still has to be resolved and its addresses checked.
 */
export function checkTarget(raw: string | URL): TargetCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: "invalid_target" };
  }
  const defaultPort = DEFAULT_PORTS[url.protocol];
  if (defaultPort === undefined || url.username !== "" || url.password !== "") {
    return { ok: false, code: "invalid_target" };
  }

  let host = url.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  host = host.replace(/\.+$/, "");
  if (host === "") return { ok: false, code: "invalid_target" };
  if (isReservedName(host)) return { ok: false, code: "blocked_address" };

  const port = url.port === "" ? defaultPort : Number(url.port);
  if (BAD_PORTS.has(port)) return { ok: false, code: "blocked_port" };

  if (!ipaddr.isValid(host)) return { ok: true, url, host, literal: null };
  if (!isPublicAddress(host)) return { ok: false, code: "blocked_address" };
  return { ok: true, url, host, literal: host };
}
