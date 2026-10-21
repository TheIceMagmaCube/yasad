import { and, count, eq } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";

import { formatCatalog } from "../catalog/format";
import { importCatalog, readCatalog } from "../catalog/sync";
import { checkCapacity, WORKERS_BUDGET } from "../checks/budget";
import { staleAfterMinutes } from "../checks/status";
import type { AppEnv } from "../context";
import { apiError } from "../errors";
import { category, categoryGroup, link, linkGroup } from "../schema";
import { readJson } from "./body";
import { auditorOf, requireAdmin } from "./require-admin";

export const MAX_CATALOG_BODY = 1024 * 1024;

export const adminCatalog = new Hono<AppEnv>();

/** Refuse every write to the catalog while CATALOG_FILE manages it, before reading the body. */
export const catalogWritable: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method !== "GET" && c.var.config.catalogFile) {
    return apiError(c, 409, "catalog_managed_by_file", "The catalog is loaded from CATALOG_FILE at startup; edit that file instead.");
  }
  await next();
};

adminCatalog.use("*", requireAdmin, catalogWritable);

adminCatalog.get("/", async (c) => {
  c.header("Content-Disposition", 'attachment; filename="catalog.yaml"');
  c.header("Cache-Control", "no-store");
  return c.body(formatCatalog(await readCatalog(c.var.db)), 200, { "Content-Type": "application/yaml; charset=utf-8" });
});

/**
 * Return whether CATALOG_FILE manages the catalog, how many categories, links and distinct groups it uses, and how
 * links are checked: `checked` counts the active checked links (the ones the scheduler claims); `capacity` is the
 * number a Worker can check per interval, null on Docker, which has no fixed capacity.
 */
adminCatalog.get("/state", async (c) => {
  const db = c.var.db;
  const usedGroups = db
    .select({ groupId: categoryGroup.groupId })
    .from(categoryGroup)
    .union(db.select({ groupId: linkGroup.groupId }).from(linkGroup))
    .as("used_group");
  const [categories, links, groups, checked] = await Promise.all([
    db.select({ n: count() }).from(category).get(),
    db.select({ n: count() }).from(link).get(),
    db.select({ n: count() }).from(usedGroups).get(),
    db.select({ n: count() }).from(link).where(and(eq(link.check, true), eq(link.active, true))).get(),
  ]);
  const settings = c.var.config.statusChecks;
  c.header("Cache-Control", "no-store");
  return c.json({
    managedByFile: c.var.config.catalogFile !== null,
    categories: categories!.n,
    links: links!.n,
    groups: groups!.n,
    checks: {
      intervalMinutes: settings.intervalMinutes,
      staleAfterMinutes: staleAfterMinutes(settings.intervalMinutes),
      checked: checked!.n,
      capacity: c.var.runtime === "workers" ? checkCapacity(settings, WORKERS_BUDGET) : null,
    },
  });
});

/** Import a catalog file: `dryRun` previews the changes, otherwise they are applied after checking `baseVersion`. */
adminCatalog.post("/", async (c) => {
  const fields = await readJson(c);
  if (typeof fields.yaml !== "string") return apiError(c, 422, "invalid_input", "Send the catalog file as `yaml`.");
  const dryRun = fields.dryRun === true;
  if (!dryRun && typeof fields.baseVersion !== "string") {
    return apiError(c, 422, "invalid_input", "Send the `baseVersion` returned by the preview.");
  }

  const result = await importCatalog(c.var.db, fields.yaml, {
    dryRun,
    baseVersion: dryRun ? undefined : (fields.baseVersion as string),
    auditor: await auditorOf(c),
  });
  if (result.status === "invalid") return apiError(c, 422, "invalid_catalog", "The catalog file is not valid.", { errors: result.errors });
  if (result.status === "changed") return apiError(c, 409, "catalog_changed", "The catalog changed since the preview. Preview again.");
  return c.json({ applied: result.status === "applied", diff: result.diff, baseVersion: result.baseVersion });
});
