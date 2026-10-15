/**
 * Return the client address from an X-Forwarded-For header, or null.
 *
 * Each proxy appends the address it received the request from, so the last entry is the one written by
 * the proxy in front of YASAD; earlier entries come from the client and can be forged.
 */
export function forwardedClientIp(header: string | undefined): string | null {
  const entries = (header ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.at(-1) ?? null;
}
