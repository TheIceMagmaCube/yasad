import { Hono } from "hono";

import type { AppEnv, Runtime } from "../context";
import { type SourceLinks, sourceLinksOf, version } from "../version";
import { requireUser } from "./require-user";
import { viewerOf } from "./viewer";

/** Body of `GET /api/about`: `instance` only for an admin. */
export type AboutResponse = {
  version: string;
  source: SourceLinks;
  instance?: { runtime: Runtime; catalogManagedByFile: boolean };
};

export const about = new Hono<AppEnv>();

// An allow-list: never the catalog file's path nor any other configuration value. No database read besides the session.
about.get("/", requireUser, async (c) => {
  const viewer = await viewerOf(c);
  const body: AboutResponse = { version, source: sourceLinksOf(version) };
  if (viewer.kind === "user" && viewer.role === "admin") {
    body.instance = { runtime: c.var.runtime, catalogManagedByFile: c.var.config.catalogFile !== null };
  }
  c.header("Cache-Control", "private, no-store");
  return c.json(body);
});
