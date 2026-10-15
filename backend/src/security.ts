import type { Context, MiddlewareHandler } from "hono";

import type { AppEnv } from "./context";
import { apiError } from "./errors";

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** Return the security headers sent with every response; HSTS only when served over https. */
export function securityHeaders(https: boolean): Record<string, string> {
  return {
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    ...(https ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
  };
}

/** Return the Cloudflare `_headers` file applying the same headers to the Worker's static assets. */
export function headersFile(): string {
  const lines = Object.entries(securityHeaders(true)).map(([name, value]) => `  ${name}: ${value}`);
  return ["# Generated from backend/src/security.ts (checked by backend/test/unit/security.test.ts).", "/*", ...lines, ""].join("\n");
}

/** Return a middleware adding the security headers to the response, decided by `isHttps`. */
export function withSecurityHeaders<E extends AppEnv | object>(isHttps: (c: Context<E>) => boolean): MiddlewareHandler<E> {
  return async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(securityHeaders(isHttps(c)))) c.res.headers.set(name, value);
  };
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Refuse state-changing requests that do not come from the app itself.
 *
 * A request is refused when the browser marks it cross-site, when its Origin differs from PUBLIC_URL, or
 * when its body is not JSON (a cross-site form can send text/plain without a CORS preflight). Requests
 * without Origin, sent by non-browser clients, are accepted.
 */
export const sameOriginOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!UNSAFE_METHODS.has(c.req.method)) return next();
  const origin = c.req.header("origin");
  if (c.req.header("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(c.var.config.publicUrl).origin)) {
    return apiError(c, 403, "cross_site_request", "Cross-site requests are not allowed.");
  }
  const type = c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") return apiError(c, 415, "unsupported_media_type", "Send the request body as JSON.");
  await next();
};
