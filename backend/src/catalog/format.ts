import { type Document, isAlias, isMap, isNode, isPair, isScalar, isSeq, type Node, type Pair, parseDocument, stringify, visit } from "yaml";
import { z } from "zod";

export const ID = z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(64);
const GROUP_REF = z.string().regex(/^(@everyone|@authenticated|(oidc|local):\S(.*\S)?)$/);
export const ICON = z.string().max(100).regex(/^(si:[a-z0-9_-]+|lucide:[a-z0-9-]+)$/);
const URL_HTTP = z
  .string()
  .max(2048)
  .refine((v) => URL.canParse(v) && ["http:", "https:"].includes(new URL(v).protocol));

/** A link as the catalog file writes it; the app validates its edits with the same rules. */
export const linkSchema = z.strictObject({
  id: ID,
  title: z.string().trim().min(1).max(100),
  url: URL_HTTP,
  description: z.string().trim().max(500).optional(),
  icon: ICON.optional(),
  keywords: z.array(z.string().trim().min(1).max(50)).max(30).optional(),
  groups: z.array(GROUP_REF).max(50),
  active: z.boolean().optional(),
});

/** The fields of a category other than its links. */
export const categoryFields = { id: ID, title: z.string().trim().min(1).max(100), groups: z.array(GROUP_REF).max(50) };

/** Most categories and links per category a file may hold, so an exported catalog can be imported again. */
export const MAX_CATEGORIES = 200;
export const MAX_LINKS_PER_CATEGORY = 1000;

const categorySchema = z.strictObject({
  ...categoryFields,
  links: z
    .array(linkSchema)
    .max(MAX_LINKS_PER_CATEGORY)
    .nullish()
    .transform((v) => v ?? []),
});

const catalogSchema = z.strictObject({
  version: z.literal(1),
  categories: z
    .array(categorySchema)
    .max(MAX_CATEGORIES)
    .nullish()
    .transform((v) => v ?? []),
});

/** An empty `links:` or `categories:` (null in YAML) means an empty list. */
export type Catalog = z.output<typeof catalogSchema>;
export type CatalogCategory = Catalog["categories"][number];
export type CatalogLink = CatalogCategory["links"][number];
/** A problem in the file, as a code the interface translates, with the values its message needs. */
export type CatalogError = { path: string; code: string; params: Record<string, unknown> };
export type Parsed = { ok: true; catalog: Catalog } | { ok: false; errors: CatalogError[] };

/** Return a path such as `categories[0].links[2].url`. */
function pathOf(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, key) => (typeof key === "number" ? `${acc}[${key}]` : acc ? `${acc}.${String(key)}` : String(key)), "");
}

/** Return the path of a YAML node from its ancestors, written as {@link pathOf} writes it. */
function pathOfNodes(ancestors: readonly (Document | Node | Pair)[], node: Node): string {
  const keys: PropertyKey[] = [];
  ancestors.forEach((parent, i) => {
    const child = ancestors[i + 1] ?? node;
    if (isPair(parent) && isScalar(parent.key)) keys.push(String(parent.key.value));
    else if (isSeq(parent)) keys.push(parent.items.indexOf(child as Node));
  });
  return pathOf(keys);
}

/** Return the error for one zod issue, named after the field it concerns. */
export function errorOf(issue: z.core.$ZodIssue): CatalogError {
  const path = pathOf(issue.path);
  if (issue.code === "unrecognized_keys") return { path, code: "unknown_field", params: { fields: issue.keys } };
  if (issue.code === "too_big") return { path, code: "too_long", params: { max: Number(issue.maximum) } };
  if (issue.code === "too_small" || (issue.code === "invalid_type" && issue.input === undefined)) return { path, code: "required", params: {} };
  const [parent, field] = [issue.path.at(-2), issue.path.at(-1)];
  const code =
    field === "id" ? "invalid_id" : parent === "groups" ? "invalid_group_ref" : field === "icon" ? "invalid_icon" : field === "url" ? "invalid_url" : "invalid";
  return { path, code, params: {} };
}

/** Return the errors for ids used twice: categories among themselves, links across the whole file. */
function duplicateIds(catalog: Catalog): CatalogError[] {
  const errors: CatalogError[] = [];
  const categories = new Set<string>();
  const links = new Set<string>();
  catalog.categories.forEach((cat, i) => {
    if (categories.has(cat.id)) errors.push({ path: `categories[${i}].id`, code: "duplicate_id", params: { id: cat.id } });
    categories.add(cat.id);
    cat.links.forEach((lnk, j) => {
      if (links.has(lnk.id)) errors.push({ path: `categories[${i}].links[${j}].id`, code: "duplicate_id", params: { id: lnk.id } });
      links.add(lnk.id);
    });
  });
  return errors;
}

/**
 * Parse and validate a catalog file.
 *
 * Every problem is reported at once, with its path. Anchors and aliases are refused: a catalog has
 * no use for them, and aliases can expand a small file into a huge document. Keys written twice are
 * found here with one set per table: the parser's own check compares each key with all the previous
 * ones, which stalls on a large table.
 */
export function parseCatalog(text: string): Parsed {
  const doc = parseDocument(text, { uniqueKeys: false });
  if (doc.errors.length > 0) {
    return { ok: false, errors: doc.errors.map((e) => ({ path: "", code: "yaml_syntax", params: { line: e.linePos?.[0].line } })) };
  }
  let usesAnchors = false;
  const duplicateKeys: CatalogError[] = [];
  visit(doc, (_key, node, path) => {
    if (isAlias(node) || (isNode(node) && node.anchor)) usesAnchors = true;
    if (!isMap(node)) return;
    const seen = new Set<unknown>();
    for (const pair of node.items) {
      const key = isScalar(pair.key) ? pair.key.value : pair.key;
      if (seen.has(key)) duplicateKeys.push({ path: pathOfNodes(path, node), code: "duplicate_key", params: { key: String(key) } });
      seen.add(key);
    }
  });
  if (usesAnchors) return { ok: false, errors: [{ path: "", code: "anchors_not_allowed", params: {} }] };
  if (duplicateKeys.length > 0) return { ok: false, errors: duplicateKeys };

  const result = catalogSchema.safeParse(doc.toJS({ maxAliasCount: 0 }), { reportInput: true });
  if (!result.success) return { ok: false, errors: result.error.issues.map(errorOf) };
  const duplicates = duplicateIds(result.data);
  return duplicates.length > 0 ? { ok: false, errors: duplicates } : { ok: true, catalog: result.data };
}

/**
 * Return the keywords stored in a `link.keywords` column.
 *
 * The column holds a JSON array of strings. Anything else (invalid JSON, not an array) gives an
 * empty list, and items that are not non-empty strings are dropped, so a corrupt row never fails a
 * request. Values are returned as stored: folding for search happens in the browser.
 */
export function parseKeywords(text: string | null | undefined): string[] {
  let value: unknown;
  try {
    value = JSON.parse(text ?? "[]");
  } catch {
    return [];
  }
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : [];
}

/** Write the catalog as YAML, leaving out default values so a hand-written file comes back unchanged. */
export function formatCatalog(catalog: Catalog): string {
  const compact = {
    version: catalog.version,
    categories: catalog.categories.map((cat) => ({
      id: cat.id,
      title: cat.title,
      groups: cat.groups,
      links: cat.links.map((lnk) => ({
        id: lnk.id,
        title: lnk.title,
        url: lnk.url,
        ...(lnk.description ? { description: lnk.description } : {}),
        ...(lnk.icon ? { icon: lnk.icon } : {}),
        ...(lnk.keywords?.length ? { keywords: lnk.keywords } : {}),
        groups: lnk.groups,
        ...(lnk.active === false ? { active: false } : {}),
      })),
    })),
  };
  return stringify(compact, { lineWidth: 0, aliasDuplicateObjects: false });
}
