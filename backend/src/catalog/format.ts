import { isAlias, isNode, parseDocument, stringify, visit } from "yaml";
import { z } from "zod";

const ID = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "Use lower-case letters, digits and dashes.").max(64);
const GROUP_REF = z
  .string()
  .regex(/^(@everyone|@authenticated|(oidc|local):\S(.*\S)?)$/, "Use @everyone, @authenticated, oidc:<name> or local:<name>.");
const ICON = z.string().regex(/^(si|lucide):[a-z0-9-]+$/, "Use si:<slug> or lucide:<name>.");
const URL_HTTP = z
  .string()
  .max(2048)
  .refine((v) => URL.canParse(v) && ["http:", "https:"].includes(new URL(v).protocol), "Use an http or https URL.");

const linkSchema = z.strictObject({
  id: ID,
  title: z.string().trim().min(1).max(100),
  url: URL_HTTP,
  description: z.string().trim().max(500).optional(),
  icon: ICON.optional(),
  keywords: z.array(z.string().trim().min(1).max(50)).max(30).optional(),
  groups: z.array(GROUP_REF).max(50),
  active: z.boolean().optional(),
});

const categorySchema = z.strictObject({
  id: ID,
  title: z.string().trim().min(1).max(100),
  groups: z.array(GROUP_REF).max(50),
  links: z
    .array(linkSchema)
    .max(1000)
    .nullish()
    .transform((v) => v ?? []),
});

const catalogSchema = z.strictObject({
  version: z.literal(1),
  categories: z
    .array(categorySchema)
    .max(200)
    .nullish()
    .transform((v) => v ?? []),
});

/** An empty `links:` or `categories:` (null in YAML) means an empty list. */
export type Catalog = z.output<typeof catalogSchema>;
export type CatalogCategory = Catalog["categories"][number];
export type CatalogLink = CatalogCategory["links"][number];
export type CatalogError = { path: string; message: string };
export type Parsed = { ok: true; catalog: Catalog } | { ok: false; errors: CatalogError[] };

/** Return a path such as `categories[0].links[2].url`. */
function pathOf(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, key) => (typeof key === "number" ? `${acc}[${key}]` : acc ? `${acc}.${String(key)}` : String(key)), "");
}

/** Return the errors for ids used twice: categories among themselves, links across the whole file. */
function duplicateIds(catalog: Catalog): CatalogError[] {
  const errors: CatalogError[] = [];
  const categories = new Set<string>();
  const links = new Set<string>();
  catalog.categories.forEach((cat, i) => {
    if (categories.has(cat.id)) errors.push({ path: `categories[${i}].id`, message: `The category id "${cat.id}" is used twice.` });
    categories.add(cat.id);
    cat.links.forEach((lnk, j) => {
      if (links.has(lnk.id)) errors.push({ path: `categories[${i}].links[${j}].id`, message: `The link id "${lnk.id}" is used twice.` });
      links.add(lnk.id);
    });
  });
  return errors;
}

/**
 * Parse and validate a catalog file.
 *
 * Every problem is reported at once, with its path. Anchors and aliases are refused: a catalog has
 * no use for them, and aliases can expand a small file into a huge document.
 */
export function parseCatalog(text: string): Parsed {
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length > 0) return { ok: false, errors: doc.errors.map((e) => ({ path: "", message: e.message })) };
  let usesAnchors = false;
  visit(doc, (_key, node) => {
    if (isAlias(node) || (isNode(node) && node.anchor)) usesAnchors = true;
  });
  if (usesAnchors) return { ok: false, errors: [{ path: "", message: "Anchors and aliases are not allowed." }] };

  const result = catalogSchema.safeParse(doc.toJS({ maxAliasCount: 0 }));
  if (!result.success) {
    return { ok: false, errors: result.error.issues.map((issue) => ({ path: pathOf(issue.path), message: issue.message })) };
  }
  const duplicates = duplicateIds(result.data);
  return duplicates.length > 0 ? { ok: false, errors: duplicates } : { ok: true, catalog: result.data };
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
