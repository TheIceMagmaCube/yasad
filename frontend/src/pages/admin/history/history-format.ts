import type { HistoryEntry, HistoryObject, HistoryObjectType, HistoryQuery } from "../../../api";
import type { Messages } from "../../../i18n/en";
import { groupRefLabel } from "../../../lib/group-ref";
import { categoryHref, linkHref } from "../links/item-edit";

export const HISTORY = "/admin/history";

export const HISTORY_TYPES: readonly HistoryObjectType[] = ["user", "group", "category", "link", "catalog"];

/** Filters of the history page as the address holds them: dates are local days (`2026-10-19`), both included. */
export type HistoryFilters = { actor: string; type: string; object: string; from: string; to: string };

export const NO_FILTERS: HistoryFilters = { actor: "", type: "", object: "", from: "", to: "" };

const FILTER_KEYS = ["actor", "type", "object", "from", "to"] as const;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Return the filters an address query holds; unknown keys are ignored. */
export function readFilters(search: string): HistoryFilters {
  const params = new URLSearchParams(search);
  return Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) ?? ""])) as HistoryFilters;
}

/** Return the address query of the filters, `?` included, empty ones left out. */
export function filtersSearch(filters: Partial<HistoryFilters>): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) if (filters[key]) params.set(key, filters[key]);
  const text = params.toString();
  return text ? `?${text}` : "";
}

export const sameFilters = (a: HistoryFilters, b: HistoryFilters) => FILTER_KEYS.every((key) => a[key] === b[key]);

/**
 * Return the instant a local day starts, as ISO 8601, or the next day's start with `next` (the API's `to` is
 * excluded, the form's "To" day included); the value as typed when it is no day, for the API to refuse.
 */
export function dayStart(day: string, next = false): string {
  const match = DAY.exec(day);
  if (!match) return day;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + (next ? 1 : 0));
  return Number.isNaN(date.getTime()) ? day : date.toISOString();
}

/** Return the API query of the filters: days turned into instants in the browser's time zone. */
export function filtersQuery(filters: HistoryFilters): HistoryQuery {
  return {
    actor: filters.actor || undefined,
    type: (filters.type || undefined) as HistoryObjectType | undefined,
    object: filters.object || undefined,
    from: filters.from ? dayStart(filters.from) : undefined,
    to: filters.to ? dayStart(filters.to, true) : undefined,
  };
}

/** Return the address of the page of an object that still exists, or null. */
export function objectHref(object: HistoryObject): string | null {
  if (!object.exists || object.id === null) return null;
  const id = encodeURIComponent(object.id);
  switch (object.type) {
    case "user":
      return `/admin/users/${id}`;
    case "group":
      return `/admin/groups/${id}`;
    case "category":
      return categoryHref(object.id);
    case "link":
      return linkHref(object.id);
    default:
      return null;
  }
}

/** Return how an object reads in a cell: its label then, its id, or its type for the catalog. */
export function objectLabel(object: HistoryObject, m: Messages): string {
  return object.label ?? object.id ?? m.history.types[object.type];
}

// Fields in the order they show; a field the snapshot holds and this list does not comes after them.
const FIELD_ORDER: Record<HistoryObjectType, string[]> = {
  user: ["name", "email", "origin", "role", "roleOverride", "disabled", "mustChangePassword", "groups"],
  group: ["name", "source", "members", "categories", "links"],
  category: ["title", "position", "groups", "links"],
  link: ["title", "url", "description", "categoryId", "icon", "keywords", "active", "check", "position", "groups"],
  catalog: [],
};

export type FieldRow = { field: string; before?: unknown; after?: unknown };
/** Which values a change shows: both for a change, the new ones for a creation, the old ones for a deletion. */
export type DiffShape = "both" | "after" | "before";

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const blank = (value: unknown) => value === null || value === undefined || value === "";

/**
 * Return the fields an entry shows: those that differ between before and after, or, for a creation or a deletion,
 * the ones that hold a value. An import or a membership change has none: it shows its own detail.
 */
export function fieldRows(entry: HistoryEntry): { shape: DiffShape; rows: FieldRow[] } {
  const { before, after } = entry;
  const shape: DiffShape = before && after ? "both" : after ? "after" : "before";
  if (entry.action === "import" || (!before && !after)) return { shape, rows: [] };
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  const order = FIELD_ORDER[entry.object.type] ?? [];
  const rank = (key: string) => (order.includes(key) ? order.indexOf(key) : order.length);
  keys.sort((a, b) => rank(a) - rank(b));
  const rows: FieldRow[] = [];
  for (const field of keys) {
    const old = before?.[field];
    const now = after?.[field];
    if (shape === "both" ? same(old, now) : blank(shape === "after" ? now : old)) continue;
    rows.push(shape === "both" ? { field, before: old, after: now } : shape === "after" ? { field, after: now } : { field, before: old });
  }
  return { shape, rows };
}

/** Return the name of a field of an object type, the key itself when unknown. */
export function fieldLabel(type: HistoryObjectType, field: string, m: Messages): string {
  return (m.history.fields[type] as Record<string, string>)[field] ?? field;
}

/** Most items a list shows before "and N more". */
export const LIST_LIMIT = 20;

/** Return a list as one line, cut after {@link LIST_LIMIT} items. */
export function listText(items: string[], m: Messages): string {
  if (items.length === 0) return m.history.none;
  const shown = items.slice(0, LIST_LIMIT).join(", ");
  return items.length > LIST_LIMIT ? `${shown} ${m.history.andMore(items.length - LIST_LIMIT)}` : shown;
}

const itemName = (item: unknown): string => {
  if (item && typeof item === "object") {
    const { name, title, id } = item as { name?: unknown; title?: unknown; id?: unknown };
    return String(name ?? title ?? id ?? "");
  }
  return String(item);
};

/** Return how a stored value reads: Yes/No, lists joined, positions from 1, codes translated. */
export function valueText(type: HistoryObjectType, field: string, value: unknown, m: Messages): string {
  const h = m.history;
  if (field === "roleOverride") {
    if (value === null || value === undefined) return m.users.roleOverrideOptions.provider;
    return m.users.roleOverrideOptions[value as "admin" | "user"] ?? String(value);
  }
  if (value === null || value === undefined) return h.none;
  if (typeof value === "boolean") return value ? h.yes : h.no;
  if (field === "position" && typeof value === "number") return String(value + 1);
  if (value === "") return h.blank;
  if (field === "role") return m.roles[value as "admin" | "user"] ?? String(value);
  if (type === "user" && field === "origin") return m.users.originValue[value as "local" | "oidc"] ?? String(value);
  if (type === "group" && field === "source") return m.groups.source[value as "local" | "oidc" | "system"] ?? String(value);
  if (Array.isArray(value)) {
    const items = field === "groups" ? value.map((ref) => groupRefLabel(String(ref))) : value.map(itemName);
    return listText(items, m);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Summary of an import as the API keeps it in `details`. */
export type ImportSummary = {
  added?: { categories?: string[]; links?: string[] };
  updated?: { categories?: string[]; links?: string[] };
  removed?: { categories?: string[]; links?: string[] };
  groupsCreated?: string[];
  labels?: { categories?: Record<string, string>; links?: Record<string, { title: string }> };
  truncated?: boolean;
};

export type ImportLine = { kind: "added" | "updated" | "removed"; categories: string[]; links: string[] };

/** Return the lines of an import summary that list something, with each item's title when the summary kept it. */
export function importLines(summary: ImportSummary): ImportLine[] {
  const category = (id: string) => summary.labels?.categories?.[id] ?? id;
  const link = (id: string) => summary.labels?.links?.[id]?.title ?? id;
  return (["added", "updated", "removed"] as const)
    .map((kind) => ({ kind, categories: (summary[kind]?.categories ?? []).map(category), links: (summary[kind]?.links ?? []).map(link) }))
    .filter((line) => line.categories.length + line.links.length > 0);
}
