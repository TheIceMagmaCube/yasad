import { type Context, Hono, type MiddlewareHandler } from "hono";

import { sessionFor } from "../auth";
import {
  type Author,
  applyEdit,
  createCategory,
  createLink,
  deleteCategory,
  deleteLink,
  type Edit,
  type EditFailure,
  moveCategory,
  moveLink,
  readCategories,
  updateCategory,
  updateLink,
} from "../catalog/edit";
import type { AppEnv } from "../context";
import { apiError } from "../errors";
import { catalogWritable } from "./admin-catalog";
import { readJson } from "./body";
import { requireAdmin } from "./require-admin";

const MESSAGES: Record<string, string> = {
  invalid_input: "Some fields are not valid.",
  not_found: "No such item.",
  item_changed: "Someone changed this item since you opened it.",
  catalog_full: "The catalog holds as many items as a catalog file may.",
};

/** Run one catalog edit as the signed-in admin, and answer with `render` of the state after it, or the refusal. */
async function run<T>(
  c: Context<AppEnv>,
  prepare: (author: Author, body: Record<string, unknown>) => Promise<Edit<T> | EditFailure>,
  render: (after: T | null, edit: Edit<T>) => Response,
): Promise<Response> {
  const { db } = c.var;
  const author: Author = { db, userId: (await sessionFor(c))!.user.id };
  const body = await readJson(c);
  const result = await applyEdit(db, () => prepare(author, body));
  if ("status" in result) return apiError(c, result.status, result.code, MESSAGES[result.code] ?? result.code, result.details);
  return render(result.after, result.edit);
}

const noStore: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
};

export const adminCategories = new Hono<AppEnv>();

adminCategories.use("*", requireAdmin, catalogWritable, noStore);

/** Return the whole catalog as stored, inactive links and items without a group included. */
adminCategories.get("/", async (c) => c.json({ categories: await readCategories(c.var.db) }));

adminCategories.post("/", (c) =>
  run(c, createCategory, (category, edit) => c.json({ category, warnings: edit.warnings }, 201)),
);

adminCategories.patch("/:id", (c) =>
  run(c, (author, body) => updateCategory(author, c.req.param("id"), body), (category, edit) => c.json({ category, warnings: edit.warnings })),
);

adminCategories.post("/:id/move", (c) => run(c, (author, body) => moveCategory(author, c.req.param("id"), body), (order) => c.json({ order })));

adminCategories.delete("/:id", (c) => run(c, (author, body) => deleteCategory(author, c.req.param("id"), body), () => c.body(null, 204)));

export const adminLinks = new Hono<AppEnv>();

adminLinks.use("*", requireAdmin, catalogWritable, noStore);

adminLinks.post("/", (c) => run(c, createLink, (link, edit) => c.json({ link, warnings: edit.warnings }, 201)));

adminLinks.patch("/:id", (c) =>
  run(c, (author, body) => updateLink(author, c.req.param("id"), body), (link, edit) => c.json({ link, warnings: edit.warnings })),
);

adminLinks.post("/:id/move", (c) => run(c, (author, body) => moveLink(author, c.req.param("id"), body), (order) => c.json({ order })));

adminLinks.delete("/:id", (c) => run(c, (author, body) => deleteLink(author, c.req.param("id"), body), () => c.body(null, 204)));
