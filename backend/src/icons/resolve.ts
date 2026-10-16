import { LUCIDE, LUCIDE_ALIASES, SI } from "./names";

/** An icon the frontend can fetch: `<ICONS_BASE>/<set>/<name>.json`. */
export type Icon = { set: "si" | "lucide"; name: string };

/** Return the icon a catalog value names, with a Lucide alias replaced by its canonical name, or null when it is unknown. */
export function resolveIcon(value: string | null | undefined): Icon | null {
  if (!value) return null;
  const colon = value.indexOf(":");
  const set = value.slice(0, colon);
  const name = value.slice(colon + 1);
  if (set === "si") return SI.has(name) ? { set, name } : null;
  if (set === "lucide") {
    if (LUCIDE.has(name)) return { set, name };
    const canonical = Object.hasOwn(LUCIDE_ALIASES, name) ? LUCIDE_ALIASES[name] : undefined;
    return canonical ? { set, name: canonical } : null;
  }
  return null;
}
