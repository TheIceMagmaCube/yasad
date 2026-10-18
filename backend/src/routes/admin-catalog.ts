import { count } from "drizzle-orm";
import { Hono } from "hono";

import { formatCatalog } from "../catalog/format";
import { importCatalog, readCatalog } from "../catalog/sync";
import type { AppEnv } from "../context";
import { apiError } from "../errors";
import { category, categoryGroup, link, linkGroup } from "../schema";
import { requireAdmin } from "./require-admin";

export const MAX_CATALOG_BODY = 1024 * 1024;

export const adminCatalog = new Hono<AppEnv>();

adminCatalog.use("*", requireAdmin);

adminCatalog.get("/", async (c) => {
  c.header("Content-Disposition", 'attachment; filename="catalog.yaml"');
  c.header("Cache-Control", "no-store");
  return c.body(formatCatalog(await readCatalog(c.var.db)), 200, { "Content-Type": "application/yaml; charset=utf-8" });
});

/** Return whether CATALOG_FILE manages the catalog, and how many categories, links and distinct groups it uses. */
adminCatalog.get("/state", async (c) => {
  const db = c.var.db;
  const usedGroups = db
    .select({ groupId: categoryGroup.groupId })
    .from(categoryGroup)
    .union(db.select({ groupId: linkGroup.groupId }).from(linkGroup))
    .as("used_group");
  const [categories, links, groups] = await Promise.all([
    db.select({ n: count() }).from(category).get(),
    db.select({ n: count() }).from(link).get(),
    db.select({ n: count() }).from(usedGroups).get(),
  ]);
  c.header("Cache-Control", "no-store");
  return c.json({ managedByFile: c.var.config.catalogFile !== null, categories: categories!.n, links: links!.n, groups: groups!.n });
});

/** Import a catalog file: `dryRun` previews the changes, otherwise they are applied after checking `baseVersion`. */
adminCatalog.post("/", async (c) => {
  if (c.var.config.catalogFile) {
    return apiError(c, 409, "catalog_managed_by_file", "The catalog is loaded from CATALOG_FILE at startup; edit that file instead.");
  }
  const body: unknown = await c.req.json().catch(() => null);
  const fields = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (typeof fields.yaml !== "string") return apiError(c, 422, "invalid_input", "Send the catalog file as `yaml`.");
  const dryRun = fields.dryRun === true;
  if (!dryRun && typeof fields.baseVersion !== "string") {
    return apiError(c, 422, "invalid_input", "Send the `baseVersion` returned by the preview.");
  }

  const result = await importCatalog(c.var.db, fields.yaml, { dryRun, baseVersion: dryRun ? undefined : (fields.baseVersion as string) });
  if (result.status === "invalid") return apiError(c, 422, "invalid_catalog", "The catalog file is not valid.", { errors: result.errors });
  if (result.status === "changed") return apiError(c, 409, "catalog_changed", "The catalog changed since the preview. Preview again.");
  return c.json({ applied: result.status === "applied", diff: result.diff, baseVersion: result.baseVersion });
});
