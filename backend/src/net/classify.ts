import { OutboundError, type OutboundErrorCode, type OutboundResponse } from "./outbound";

/** State of a checked link. */
export type CheckState = "up" | "down" | "unknown";

/** Reason stored with a state; null for `up`. */
export type CheckReason =
  | "http_error"
  | "connect_failed"
  | "dns_not_found"
  | "timeout"
  | "tls_error"
  | "blocked_address"
  | "blocked_port"
  | "unsupported_on_target"
  | "resolver_failed";

/** What a check stores. */
export type Classification = { state: CheckState; reason: CheckReason | null; httpStatus: number | null };

/** State of each coded error; null means nothing is written and the link is released. */
const ERROR_STATES: Readonly<Record<OutboundErrorCode, CheckState | null>> = {
  connect_failed: "down",
  dns_not_found: "down",
  timeout: "down",
  tls_error: "down",
  blocked_address: "unknown",
  blocked_port: "unknown",
  unsupported_on_target: "unknown",
  resolver_failed: "unknown",
  not_attempted: null,
  too_large: null,
};

/**
 * Map an outbound result to the state to store. A response is down on 5xx, 404 and 410, and up otherwise (2xx, an
 * unfollowed 3xx, 401, 403, 407, 429 and the other 4xx), with its status kept. An error maps through
 * `ERROR_STATES`; null for `not_attempted` and `too_large`.
 */
export function classify(result: OutboundResponse | OutboundError): Classification | null {
  if (result instanceof OutboundError) {
    const state = ERROR_STATES[result.code];
    if (state === null) return null;
    return { state, reason: result.code as CheckReason, httpStatus: null };
  }
  const { status } = result;
  if (status >= 500 || status === 404 || status === 410) {
    return { state: "down", reason: "http_error", httpStatus: status };
  }
  return { state: "up", reason: null, httpStatus: status };
}
