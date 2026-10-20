// Node only: imported by server.ts alone (and by its tests), never by code shared with the Worker.
import { promises as dns } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";

import {
  isForbiddenHeader,
  type Outbound,
  OutboundError,
  type OutboundOptions,
  type OutboundResponse,
  outboundHeaders,
  REDIRECT_STATUSES,
} from "./net/outbound";
import { checkTarget, isPublicAddress } from "./net/policy";

/** What `nodeOutbound` needs from a resolver; `dns.promises.Resolver` fits it. */
export type NodeResolver = {
  resolve4(name: string): Promise<string[]>;
  resolve6(name: string): Promise<string[]>;
  cancel?(): void;
};

/** Per-try timeout of the default resolver, in milliseconds; the request's deadline still cuts it short. */
const RESOLVER_TIMEOUT_MS = 2000;

/** Resolver codes meaning that the name has no address of that family. */
const NO_ADDRESS = new Set(["ENOTFOUND", "ENODATA"]);

/** Socket errors that mean the target could not be reached. */
const CONNECT_ERRORS = new Set(["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "EPIPE"]);

/** Certificate and handshake errors, as Node and OpenSSL name them. */
const TLS_ERRORS = new Set(["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN"]);
const TLS_PREFIXES = ["CERT_", "ERR_TLS_", "ERR_SSL_", "UNABLE_TO_"];

/**
 * Dedicated agents: never the global ones, which Node 24 points at `HTTP_PROXY` and `HTTPS_PROXY` when
 * `NODE_USE_ENV_PROXY` is set. A proxy would resolve the name again without the policy. No `proxyEnv`, no keep-alive.
 */
const HTTP_AGENT = new http.Agent({ keepAlive: false });
const HTTPS_AGENT = new https.Agent({ keepAlive: false });

/**
 * A `lookup` hook that answers with the validated addresses only, without any system call: the socket connects to
 * an address the policy accepted. Honours `all: true` (every address, for Happy Eyeballs), `all: false` (the first one)
 * and a `family` asked for.
 */
export function pinnedLookup(addresses: readonly string[]): LookupFunction {
  const entries = addresses.map((address) => ({ address, family: isIP(address) }));
  return (_hostname, options, callback) => {
    const asked = options.family;
    const family = asked === 4 || asked === "IPv4" ? 4 : asked === 6 || asked === "IPv6" ? 6 : 0;
    const matching = family === 0 ? entries : entries.filter((entry) => entry.family === family);
    if (options.all) {
      callback(null, matching);
      return;
    }
    const first = matching[0];
    if (first === undefined) {
      callback(Object.assign(new Error("no validated address of this family"), { code: "ENOTFOUND" }), "", 0);
      return;
    }
    callback(null, first.address, first.family);
  };
}

/** Rejects with the signal's reason once it aborts, so a call that ignores the signal cannot outlive the deadline. */
function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason as Error);
    else signal.addEventListener("abort", () => reject(signal.reason as Error), { once: true });
  });
}

/** The `code` of a Node error; for an `AggregateError` (every address of a name failed), the code of the first. */
function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") return code;
  if (error instanceof AggregateError) return errorCode(error.errors[0]);
  return undefined;
}

/**
 * The coded error for a failure of the request or of reading its body: `timeout` once the deadline has passed, socket
 * errors `connect_failed`, certificate and handshake errors `tls_error`, and anything else `not_attempted`, never read
 * as the target being down.
 */
function mapError(error: unknown, signal: AbortSignal): OutboundError {
  if (error instanceof OutboundError) return error;
  if (signal.aborted) return new OutboundError("timeout", { cause: error });
  const code = errorCode(error);
  if (code === "ETIMEDOUT") return new OutboundError("timeout", { cause: error });
  if (code !== undefined && CONNECT_ERRORS.has(code)) return new OutboundError("connect_failed", { cause: error });
  if (code !== undefined && (TLS_ERRORS.has(code) || TLS_PREFIXES.some((prefix) => code.startsWith(prefix)))) {
    return new OutboundError("tls_error", { cause: error });
  }
  return new OutboundError("not_attempted", { cause: error });
}

/** Addresses of `name` from `resolve4` and `resolve6` together; `[]` when neither family has any. */
async function resolveName(resolver: NodeResolver, name: string, signal: AbortSignal): Promise<string[]> {
  let results: PromiseSettledResult<string[]>[];
  try {
    results = await Promise.race([
      Promise.allSettled([
        Promise.resolve().then(() => resolver.resolve4(name)),
        Promise.resolve().then(() => resolver.resolve6(name)),
      ]),
      untilAborted(signal),
    ]);
  } catch (error) {
    throw new OutboundError("timeout", { cause: error });
  }
  const addresses: string[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") addresses.push(...result.value);
    else if (!NO_ADDRESS.has(errorCode(result.reason) ?? "")) {
      throw new OutboundError("resolver_failed", { cause: result.reason });
    }
  }
  return addresses;
}

/** Check `url` and the addresses its name resolves to; returns the URL and the addresses to connect to. */
async function admit(
  url: string,
  resolver: NodeResolver,
  isAllowed: (ip: string) => boolean,
  signal: AbortSignal,
): Promise<{ url: URL; host: string; addresses: string[] }> {
  const target = checkTarget(url);
  if (!target.ok) throw new OutboundError(target.code === "invalid_target" ? "blocked_address" : target.code);
  if (target.literal !== null) {
    if (!isAllowed(target.literal)) throw new OutboundError("blocked_address");
    return { url: target.url, host: target.host, addresses: [target.literal] };
  }
  const addresses = await resolveName(resolver, target.host, signal);
  if (addresses.length === 0) throw new OutboundError("dns_not_found");
  if (!addresses.every((address) => isAllowed(address))) throw new OutboundError("blocked_address");
  return { url: target.url, host: target.host, addresses };
}

/** `outboundHeaders()` with the caller's headers over it, the forbidden ones left out, and `Host` from the URL. */
function requestHeaders(extra: Record<string, string> | undefined, url: URL): Record<string, string> {
  const headers = new Headers(outboundHeaders());
  for (const [name, value] of Object.entries(extra ?? {})) {
    if (!isForbiddenHeader(name)) headers.set(name, value);
  }
  headers.set("host", url.host);
  return Object.fromEntries(headers);
}

/**
 * Send one GET to `url`, connecting only to `addresses`; resolves with the response once its headers arrive. The
 * certificate and SNI are checked on the name (the `Host` header), not on the address.
 */
function send(
  target: { url: URL; host: string; addresses: string[] },
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const secure = target.url.protocol === "https:";
    const request = (secure ? https : http).request({
      protocol: target.url.protocol,
      hostname: target.host,
      port: target.url.port === "" ? (secure ? 443 : 80) : Number(target.url.port),
      path: `${target.url.pathname}${target.url.search}`,
      method: "GET",
      headers,
      agent: secure ? HTTPS_AGENT : HTTP_AGENT,
      lookup: pinnedLookup(target.addresses),
      signal,
    });
    // Kept for the request's whole life: an error after the response must not go unhandled.
    request.on("error", reject);
    request.once("response", resolve);
    request.end();
  });
}

/** Read at most `maxBytes` of `response`'s body; `too_large` beyond, after destroying the rest. */
function readBody(response: http.IncomingMessage, maxBytes: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const body = new Uint8Array(maxBytes);
    let length = 0;
    response.on("data", (chunk: Buffer) => {
      if (length + chunk.byteLength > maxBytes) {
        reject(new OutboundError("too_large"));
        response.destroy();
        return;
      }
      body.set(chunk, length);
      length += chunk.byteLength;
    });
    response.on("end", () => resolve(body.subarray(0, length)));
    response.on("error", reject);
    response.on("aborted", () => reject(Object.assign(new Error("response aborted"), { code: "ECONNRESET" })));
  });
}

/** The response headers handed back, without `Set-Cookie`: no cookie is ever kept. */
function responseHeaders(response: http.IncomingMessage): Headers {
  const headers = new Headers();
  const raw = response.rawHeaders;
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = raw[i]!;
    if (name.toLowerCase() === "set-cookie") continue;
    try {
      headers.append(name, raw[i + 1]!);
    } catch {
      // A header the Fetch `Headers` refuses is left out.
    }
  }
  return headers;
}

/**
 * The Node `Outbound`, for the Docker entry: `checkTarget`, IP literals checked with `isAllowed`, names resolved with
 * `resolve4` and `resolve6` (c-ares, not `dns.lookup`: no libuv thread is held by a DNS server that never answers, and
 * `/etc/hosts` and mDNS are not read) and every address checked, then `http.request` or `https.request` on a
 * dedicated agent whose `lookup` hook answers the validated addresses only, which closes DNS rebinding. One deadline
 * covers resolution, connection, headers, the body and every redirect hop; a followed redirect goes through the whole
 * algorithm again. `isAllowed` defaults to `isPublicAddress` and exists for transport tests only: `server.ts` never
 * passes it. The default resolver is created per request, so that the deadline cancels this request's queries only;
 * an injected one is shared and never cancelled.
 */
export function nodeOutbound(
  options: { resolver?: NodeResolver; isAllowed?: (ip: string) => boolean } = {},
): Outbound {
  const isAllowed = options.isAllowed ?? isPublicAddress;

  return {
    async request(url: string, request: OutboundOptions): Promise<OutboundResponse> {
      const signal = AbortSignal.timeout(request.deadlineMs);
      let resolver = options.resolver;
      if (resolver === undefined) {
        const own = new dns.Resolver({ timeout: RESOLVER_TIMEOUT_MS, tries: 2 });
        signal.addEventListener("abort", () => own.cancel(), { once: true });
        resolver = own;
      }

      let current = url;
      for (let hops = 0; ; hops += 1) {
        const target = await admit(current, resolver, isAllowed, signal);
        let response: http.IncomingMessage;
        try {
          const headers = requestHeaders(request.headers, target.url);
          response = await Promise.race([send(target, headers, signal), untilAborted(signal)]);
        } catch (error) {
          throw mapError(error, signal);
        }
        // Kept for the response's whole life: an error after it is handed back must not go unhandled.
        response.on("error", () => {});

        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (hops < request.maxRedirects && REDIRECT_STATUSES.has(status) && location !== undefined) {
          response.destroy();
          try {
            current = new URL(location, target.url).href;
          } catch {
            throw new OutboundError("blocked_address");
          }
          continue;
        }

        const result: OutboundResponse = { status, headers: responseHeaders(response) };
        if (request.maxBytes === 0) {
          response.destroy();
          return result;
        }
        try {
          result.body = await Promise.race([readBody(response, request.maxBytes), untilAborted(signal)]);
        } catch (error) {
          throw mapError(error, signal);
        } finally {
          response.destroy();
        }
        return result;
      }
    },
  };
}
