import { Icon, type LucideIconNode } from "lucide-react";
import { useEffect, useState } from "react";

import type { HomeIcon } from "@/api";
import { useLocale } from "@/i18n/LocaleProvider";
import { ICONS_BASE } from "@/icons-base";
import { cn } from "@/lib/utils";

/** SVG elements and attributes an icon file may carry; anything else is dropped. */
const TAGS = new Set(["path", "circle", "rect", "line", "ellipse", "polyline", "polygon"]);
const ATTRIBUTES = new Set(["d", "cx", "cy", "r", "x", "y", "width", "height", "rx", "ry", "x1", "x2", "y1", "y2", "points", "fill"]);

/** Requests in flight or done, shared by every tile showing the same icon. */
const requests = new Map<string, Promise<LucideIconNode[]>>();

/** Return the allowed nodes of a Lucide icon file, attributes filtered. */
function lucideNodes(nodes: unknown): LucideIconNode[] {
  if (!Array.isArray(nodes)) throw new Error("invalid icon file");
  return nodes.flatMap((node: unknown, i): LucideIconNode[] => {
    if (!Array.isArray(node) || typeof node[0] !== "string" || !TAGS.has(node[0]) || typeof node[1] !== "object" || node[1] === null) return [];
    const attrs = Object.fromEntries(
      Object.entries(node[1] as Record<string, unknown>).filter(([key, value]) => ATTRIBUTES.has(key) && (typeof value === "string" || typeof value === "number")),
    );
    return [[node[0], { ...attrs, key: String(i) }]];
  });
}

/** Turn an icon file into Lucide icon nodes; a Simple Icons path is filled with the current colour. */
function toNodes(set: HomeIcon["set"], data: unknown): LucideIconNode[] {
  const file = (data ?? {}) as { path?: unknown; nodes?: unknown };
  if (set === "si") {
    if (typeof file.path !== "string") throw new Error("invalid icon file");
    return [["path", { d: file.path, fill: "currentColor", stroke: "none", key: "0" }]];
  }
  return lucideNodes(file.nodes);
}

/**
 * Fetch the nodes of an icon, once per icon. A failed request is forgotten, so a later tile tries again.
 *
 * Only a JSON answer counts: depending on the target, a missing file comes back as a 404 or as index.html with a 200.
 */
export function loadIcon(icon: HomeIcon): Promise<LucideIconNode[]> {
  const key = `${icon.set}/${icon.name}`;
  let request = requests.get(key);
  if (!request) {
    request = fetch(`${ICONS_BASE}/${icon.set}/${encodeURIComponent(icon.name)}.json`)
      .then(async (res) => {
        if (!res.ok || !res.headers.get("content-type")?.includes("application/json")) throw new Error("icon not found");
        return toNodes(icon.set, await res.json());
      })
      .catch((err: unknown) => {
        requests.delete(key);
        throw err;
      });
    requests.set(key, request);
  }
  return request;
}

/** Forget every icon request; for tests. */
export function clearIconCache(): void {
  requests.clear();
}

/** Return the first visible grapheme of `title`, upper-cased for `language` and cut back to one grapheme ("ß" gives "S"). */
export function initialOf(title: string, language: string): string {
  const segmenter = new Intl.Segmenter(language, { granularity: "grapheme" });
  const first = (text: string) => {
    for (const { segment } of segmenter.segment(text)) if (!/^[\p{M}\s]+$/u.test(segment)) return segment;
    return "";
  };
  return first(first(title).toLocaleUpperCase(language));
}

type Loaded = { key: string; nodes: LucideIconNode[] | null };

/**
 * Decorative icon tile of a link: the icon drawn in the current colour, or the first letter of the title while the
 * icon has none, is unknown or fails to load. While loading, the tile is empty at its final size.
 */
export function LinkIcon({ icon, title, className }: { icon: HomeIcon | null; title: string; className?: string }) {
  const { language } = useLocale();
  const key = icon ? `${icon.set}/${icon.name}` : "";
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!icon) return;
    let active = true;
    loadIcon(icon).then(
      (nodes) => active && setLoaded({ key, nodes }),
      () => active && setLoaded({ key, nodes: null }),
    );
    return () => {
      active = false;
    };
    // The key stands for the icon: a new object with the same set and name must not fetch again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const current = icon && loaded?.key === key ? loaded : null;
  const loading = icon !== null && current === null;
  return (
    <span aria-hidden="true" data-slot="link-icon" className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", className)}>
      {current?.nodes ? (
        <Icon iconNode={current.nodes} className="size-6" />
      ) : loading ? null : (
        <span className="text-2xl leading-none font-semibold">{initialOf(title, language)}</span>
      )}
    </span>
  );
}
