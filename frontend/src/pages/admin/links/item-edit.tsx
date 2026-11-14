import { ApiError, type EditWarning } from "../../../api";
import { Alert } from "../../../components/ui/alert";
import type { Messages } from "../../../i18n/en";
import { useStrings } from "../../../i18n/LocaleProvider";
import { adminErrorText } from "../shared";

export const LIST = "/admin/links";
export const linkHref = (id: string) => `${LIST}/${encodeURIComponent(id)}`;
export const categoryHref = (id: string) => `${LIST}/categories/${encodeURIComponent(id)}`;
/**
 * Address of a link's page opened from a row of a person's preview: `as` chooses the person explained, `from` says
 * where the back link returns. The page rewrites `as` when another person is explained, never `from`.
 */
export const linkFromPreviewHref = (id: string, personId: string) => {
  const person = encodeURIComponent(personId);
  return `${linkHref(id)}?as=${person}&from=${person}`;
};

/**
 * Ids whose page address would open another page instead: /admin/links/new, /admin/links/file and
 * /admin/links/categories, /admin/links/categories/new.
 */
const RESERVED = { link: ["new", "file", "categories"], category: ["new"] } as const;

/** Return the item an `item_changed` refusal carries, as stored now; null for any other error. */
export function currentOf<T>(err: unknown): T | null {
  if (!(err instanceof ApiError) || err.body.code !== "item_changed") return null;
  return (err.body.current ?? null) as T | null;
}

/** Return whether the server refused a write because CATALOG_FILE manages the catalog. */
export function isManagedByFile(err: unknown): boolean {
  return err instanceof ApiError && err.body.code === "catalog_managed_by_file";
}

/** Return the text of an error of the catalog edit API. */
export function linksErrorText(err: unknown, m: Messages): string {
  if (err instanceof ApiError) {
    // The generic text of this code speaks of a group the file uses; here the whole catalog is read only.
    if (err.body.code === "catalog_managed_by_file") return m.links.managedByFile;
    if (err.body.code === "item_changed") return m.links.conflict;
  }
  return adminErrorText(err, m);
}

/** Return the id a title suggests, as the server derives it: accents dropped, lower case, other runs a hyphen. */
export function idFromTitle(title: string, fallback: string): string {
  const id = title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 64)
    .replace(/^-+|-+$/g, "");
  return id || fallback;
}

/** Return `base`, or the first of `base-2`, `base-3`... that is neither taken nor the address of another page. */
export function freeId(base: string, taken: ReadonlySet<string>, kind: "link" | "category"): string {
  const unusable = (id: string) => taken.has(id) || (RESERVED[kind] as readonly string[]).includes(id);
  if (!unusable(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const id = base.slice(0, 64 - suffix.length).replace(/-+$/, "") + suffix;
    if (!unusable(id)) return id;
  }
}

/** Return whether an id would hide behind the address of another page. */
export function isReservedId(id: string, kind: "link" | "category"): boolean {
  return (RESERVED[kind] as readonly string[]).includes(id);
}

/** Render the stored value of a field under it after a conflict, when it differs from what the form holds. */
export function Current({ value, mine }: { value: string | undefined; mine: string }) {
  const m = useStrings();
  if (value === undefined || value === mine) return null;
  return (
    <p data-slot="current-value" className="border-l-2 border-warning pl-2 text-sm wrap-anywhere">
      {m.links.current(value === "" ? m.links.empty : value)}
    </p>
  );
}

/** Render the warnings of a write that went through. */
export function Warnings({ warnings }: { warnings: EditWarning[] }) {
  const m = useStrings();
  if (warnings.length === 0) return null;
  return (
    <Alert variant="warning">
      <ul className="flex flex-col gap-1">
        {warnings.map((w) => (
          <li key={w}>{m.links.warnings[w]}</li>
        ))}
      </ul>
    </Alert>
  );
}
