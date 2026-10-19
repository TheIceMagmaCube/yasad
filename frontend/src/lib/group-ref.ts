import type { GroupSource } from "../api";

/** Return the catalog reference of a group: `@everyone`, `local:Finance`, `oidc:staff`. */
export function groupRefOf({ source, name }: { source: GroupSource; name: string }): string {
  return source === "system" ? `@${name}` : `${source}:${name}`;
}

/** Return whether a group comes from the identity provider but was only typed, never received in a sign-in. */
export function neverReceived(group: { source: GroupSource; seenAt: string | null }): boolean {
  return group.source === "oidc" && !group.seenAt;
}
