/**
 * Return the client address from an X-Forwarded-For header, or null.
 *
 * Each proxy appends the address it received the request from. With `proxies` trusted proxies in front of
 * YASAD, the client address is the entry at that position from the end; earlier entries come from the
 * client and can be forged.
 */
export function forwardedClientIp(header: string | undefined, proxies: number): string | null {
  const entries = (header ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length >= proxies ? (entries.at(-proxies) ?? null) : null;
}
