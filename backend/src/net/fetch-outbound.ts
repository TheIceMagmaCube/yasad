import { resolveDoh } from "./doh";
import {
  isForbiddenHeader,
  type Outbound,
  OutboundError,
  type OutboundOptions,
  type OutboundResponse,
  outboundHeaders,
  REDIRECT_STATUSES,
} from "./outbound";
import { checkTarget, isPublicAddress } from "./policy";

/** Resolves a host name to its addresses, under the request's deadline; rejects with an `OutboundError`. */
export type Resolve = (name: string, signal: AbortSignal) => Promise<string[]>;

/** `outboundHeaders()` with the caller's headers over it, the forbidden ones left out. */
function requestHeaders(extra: Record<string, string> | undefined): Headers {
  const headers = new Headers(outboundHeaders());
  for (const [name, value] of Object.entries(extra ?? {})) {
    if (!isForbiddenHeader(name)) headers.set(name, value);
  }
  return headers;
}

/** Rejects with the signal's reason once it aborts, so a call that ignores the signal cannot outlive the deadline. */
function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason as Error);
    else signal.addEventListener("abort", () => reject(signal.reason as Error), { once: true });
  });
}

/**
 * The coded error for a failure of `fetch` or of reading its body: `timeout` once the deadline has passed, a
 * `TypeError` is a network failure (`tls_error` when its message names the certificate, TLS or SSL), and anything
 * else is a platform error, `not_attempted`, never read as the target being down.
 */
function mapFetchError(error: unknown, signal: AbortSignal): OutboundError {
  if (error instanceof OutboundError) return error;
  if (signal.aborted) return new OutboundError("timeout", { cause: error });
  if (error instanceof TypeError) {
    const code = /certificate|tls|ssl/i.test(error.message) ? "tls_error" : "connect_failed";
    return new OutboundError(code, { cause: error });
  }
  return new OutboundError("not_attempted", { cause: error });
}

/** Check `url` and the addresses its name resolves to; returns the URL to fetch. */
async function admit(url: string, resolve: Resolve, signal: AbortSignal): Promise<URL> {
  const target = checkTarget(url);
  if (!target.ok) throw new OutboundError(target.code === "invalid_target" ? "blocked_address" : target.code);
  if (target.literal !== null) throw new OutboundError("unsupported_on_target");

  let addresses: string[];
  try {
    addresses = await Promise.race([resolve(target.host, signal), untilAborted(signal)]);
  } catch (error) {
    if (error instanceof OutboundError) throw error;
    throw new OutboundError("resolver_failed", { cause: error });
  }
  if (addresses.length === 0) throw new OutboundError("dns_not_found");
  if (!addresses.every((address) => isPublicAddress(address))) throw new OutboundError("blocked_address");
  return target.url;
}

/** Read at most `maxBytes` of `response`'s body; `too_large` beyond, after cancelling the rest. */
async function readBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const body = new Uint8Array(maxBytes);
  if (response.body === null) return body.subarray(0, 0);
  const reader = response.body.getReader();
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return body.subarray(0, length);
    if (length + value.byteLength > maxBytes) {
      await reader.cancel();
      throw new OutboundError("too_large");
    }
    body.set(value, length);
    length += value.byteLength;
  }
}

/** The response headers handed back, without `Set-Cookie`: no cookie is ever kept. */
function responseHeaders(response: Response): Headers {
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  return headers;
}

/**
 * The portable `Outbound`, for Workers and the API tests: `checkTarget`, any IP literal refused with
 * `unsupported_on_target` (Cloudflare answers a 403 that would read as up), resolution through `resolve` (DoH over
 * `fetch` by default) with every address checked, then `fetch` with `redirect: "manual"` and no cache. One
 * `AbortSignal.timeout(deadlineMs)` covers every step and every redirect hop. A followed redirect goes through the
 * whole algorithm again. The Worker cannot pin the address it checked: the edge resolves the name again.
 */
export function fetchOutbound(deps: { fetch?: typeof fetch; resolve?: Resolve } = {}): Outbound {
  const fetcher = deps.fetch ?? ((input, init) => fetch(input, init));
  const resolve: Resolve = deps.resolve ?? ((name, signal) => resolveDoh(name, { fetch: fetcher, signal }));

  return {
    async request(url: string, options: OutboundOptions): Promise<OutboundResponse> {
      const signal = AbortSignal.timeout(options.deadlineMs);
      const headers = requestHeaders(options.headers);
      let current = url;
      for (let hops = 0; ; hops += 1) {
        const target = await admit(current, resolve, signal);
        let response: Response;
        try {
          response = await Promise.race([
            fetcher(target.href, {
              method: "GET",
              redirect: "manual",
              headers,
              cache: "no-store",
              signal,
            }),
            untilAborted(signal),
          ]);
        } catch (error) {
          throw mapFetchError(error, signal);
        }

        const location = response.headers.get("location");
        if (hops < options.maxRedirects && REDIRECT_STATUSES.has(response.status) && location !== null) {
          await response.body?.cancel().catch(() => {});
          try {
            current = new URL(location, target).href;
          } catch {
            throw new OutboundError("blocked_address");
          }
          continue;
        }

        const result: OutboundResponse = { status: response.status, headers: responseHeaders(response) };
        if (options.maxBytes === 0) {
          await response.body?.cancel().catch(() => {});
          return result;
        }
        try {
          result.body = await Promise.race([readBody(response, options.maxBytes), untilAborted(signal)]);
        } catch (error) {
          await response.body?.cancel().catch(() => {});
          throw mapFetchError(error, signal);
        }
        return result;
      }
    },
  };
}
