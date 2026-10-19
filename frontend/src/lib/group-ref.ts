import type { GroupSource } from "../api";

/** Return the catalog reference of a group: `@everyone`, `local:Finance`, `oidc:staff`. */
export function groupRefOf({ source, name }: { source: GroupSource; name: string }): string {
  return source === "system" ? `@${name}` : `${source}:${name}`;
}

/** Return whether a group comes from the identity provider but was only typed, never received in a sign-in. */
export function neverReceived(group: { source: GroupSource; seenAt: string | null }): boolean {
  return group.source === "oidc" && !group.seenAt;
}

/** Return the source and name a catalog reference stands for. */
export function parseGroupRef(ref: string): { source: GroupSource; name: string } {
  if (ref.startsWith("@")) return { source: "system", name: ref.slice(1) };
  const colon = ref.indexOf(":");
  return { source: ref.slice(0, colon) as GroupSource, name: ref.slice(colon + 1) };
}

/** Return how a reference reads on screen: the group's name, built-in ones with their `@`. */
export function groupRefLabel(ref: string): string {
  const { source, name } = parseGroupRef(ref);
  return source === "system" ? `@${name}` : name;
}
