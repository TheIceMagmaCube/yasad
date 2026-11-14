import { imageIdOf } from "../images/store";
import { LUCIDE, LUCIDE_ALIASES, SI } from "./names";

/** An icon the frontend can draw: `<ICONS_BASE>/<set>/<name>.json` for a built-in set, `/api/images/<name>` for an image. */
export type Icon = { set: "si" | "lucide" | "image"; name: string };

/**
 * Return the icon a catalog value names, with a Lucide alias replaced by its canonical name, or null when it is unknown.
 *
 * An image is returned without reading the database: whether it is still stored is for the caller to check, and the
 * home page falls back to the initial when it is not.
 */
export function resolveIcon(value: string | null | undefined): Icon | null {
  if (!value) return null;
  const imageId = imageIdOf(value);
  if (imageId) return { set: "image", name: imageId };
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
