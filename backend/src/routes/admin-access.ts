import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";

import { audienceOf, explainAccess, type UserViewer, type Viewer } from "../access";
import type { AppEnv } from "../context";
import { apiError } from "../errors";
import { category, link, user } from "../schema";
import { noStore } from "./admin-links";
import { homeOf } from "./home";
import { requireAdmin } from "./require-admin";

/**
 * Return the viewer a person would be, built from their `user` row and never from a session, so a preview
 * gives the administrator none of their rights; null when there is no such person.
 */
async function personViewer(c: Context<AppEnv>, id: string): Promise<UserViewer | null> {
  const row = await c.var.db.select({ id: user.id, role: user.role }).from(user).where(eq(user.id, id)).get();
  return row ? { kind: "user", userId: row.id, role: row.role === "admin" ? "admin" : "user" } : null;
}

const notFound = (c: Context<AppEnv>) => apiError(c, 404, "not_found", "No such item.");

/** Return the home page of `viewer`, as `GET /api/home` builds it. */
const previewOf = (c: Context<AppEnv>, viewer: Viewer) =>
  homeOf(c.var.db, viewer, { now: Date.now(), intervalMinutes: c.var.config.statusChecks.intervalMinutes });

/** Read only: what people see and why. Every other method answers 404, as no route matches. */
export const adminAccess = new Hono<AppEnv>();

// noStore first, so the refusals of requireAdmin are not cached either.
adminAccess.use("*", noStore, requireAdmin);

/** Return the person's home page exactly as they get it, disabled or with a temporary password included. */
adminAccess.get("/users/:id/home", async (c) => {
  const viewer = await personViewer(c, c.req.param("id"));
  if (!viewer) return notFound(c);
  return c.json(await previewOf(c, viewer));
});

/** Return, for every link of the catalog, whether the person sees it and why not. */
adminAccess.get("/users/:id/links", async (c) => {
  const viewer = await personViewer(c, c.req.param("id"));
  if (!viewer) return notFound(c);
  return c.json({ links: await explainAccess(c.var.db, viewer) });
});

/** Return who sees the link, and with `?as=<userId>` whether that person does and why not. */
adminAccess.get("/links/:id", async (c) => {
  const id = c.req.param("id");
  const as = c.req.query("as");
  const exists = await c.var.db.select({ id: link.id }).from(link).where(eq(link.id, id)).get();
  if (!exists) return notFound(c);
  if (as === undefined) return c.json({ audience: await audienceOf(c.var.db, { linkId: id }) });
  const viewer = await personViewer(c, as);
  if (!viewer) return notFound(c);
  const [explanation] = await explainAccess(c.var.db, viewer, id);
  // The link may be deleted between the two reads.
  if (!explanation) return notFound(c);
  return c.json({ audience: await audienceOf(c.var.db, { linkId: id }), explanation });
});

/** Return who sees at least one link of the category. */
adminAccess.get("/categories/:id", async (c) => {
  const id = c.req.param("id");
  const exists = await c.var.db.select({ id: category.id }).from(category).where(eq(category.id, id)).get();
  if (!exists) return notFound(c);
  return c.json({ audience: await audienceOf(c.var.db, { categoryId: id }) });
});

/** Return the home page of a visitor who is not signed in. */
adminAccess.get("/visitor/home", async (c) => c.json(await previewOf(c, { kind: "anonymous" })));
