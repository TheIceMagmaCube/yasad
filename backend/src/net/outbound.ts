import { version } from "../version";

/**
 * Why an outbound request gave no response. `not_attempted` covers platform errors and anything not mapped to a
 * network failure: it must never be read as the target being down.
 */
export type OutboundErrorCode =
  | "blocked_address"
  | "blocked_port"
  | "unsupported_on_target"
  | "dns_not_found"
  | "resolver_failed"
  | "connect_failed"
  | "tls_error"
  | "timeout"
  | "too_large"
  | "not_attempted";

/** The only error an `Outbound` rejects with. */
export class OutboundError extends Error {
  readonly code: OutboundErrorCode;

  constructor(code: OutboundErrorCode, options?: { cause?: unknown }) {
    super(code, options);
    this.name = "OutboundError";
    this.code = code;
  }
}

/** Status and headers of the first response; `body` only when it was read (`maxBytes` above 0). */
export type OutboundResponse = { status: number; headers: Headers; body?: Uint8Array };

/**
 * One request. `deadlineMs` covers resolution, connection and headers together. `maxBytes` 0 and `maxRedirects` 0
 * cancel the body once the headers arrive and return a redirect as it is.
 */
export type OutboundOptions = {
  method?: "GET";
  headers?: Record<string, string>;
  deadlineMs: number;
  maxBytes: number;
  maxRedirects: number;
};

/** A guarded outbound HTTP client: every target and every resolved address goes through the policy. */
export interface Outbound {
  /** Resolves with the response, whatever its status; rejects only with an `OutboundError`. */
  request(url: string, options: OutboundOptions): Promise<OutboundResponse>;
}

/** The headers every outbound request starts from, built anew on each call; nothing from an incoming request. */
export function outboundHeaders(): Record<string, string> {
  return {
    "User-Agent": `YASAD-status/${version} (+https://github.com/TheIceMagmaCube/yasad)`,
    Accept: "*/*",
  };
}
