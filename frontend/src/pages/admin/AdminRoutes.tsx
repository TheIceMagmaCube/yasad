import type { User } from "../../api";
import { Forbidden, NotFound } from "../ErrorViews";
import { Dashboard } from "./Dashboard";
import { LinksFilePage, LinksPage } from "./links/LinksPage";
import { PeoplePage, type PeopleRoute } from "./people/PeoplePage";

/** What a canonical /admin path opens; `open` is the item whose detail shows ("new" for the creation form). */
export type AdminRoute =
  | { section: "dashboard" }
  | { section: "users"; open: PeopleRoute }
  | { section: "links"; open: { kind: "link" | "category"; id: string } | null }
  | { section: "links-file" };

/** Address of the YAML import and export, which /admin/catalog used to be. */
export const LINKS_FILE = "/admin/links/file";

/** Return the canonical form of an /admin path: the section home for /admin, the moved catalog screen for /admin/catalog. */
export function canonicalAdminPath(path: string): string {
  if (path === "/admin/catalog") return LINKS_FILE;
  // People and groups are one section: the groups are a filter of the people table.
  if (path === "/admin/groups") return "/admin/users";
  // Groups are created by the one "Add" wizard of the people section.
  if (path === "/admin/groups/new") return "/admin/users/new";
  return path;
}

/** Return the route of an /admin path, or null for an address that opens nothing. */
export function adminRoute(path: string): AdminRoute | null {
  let parts: string[];
  try {
    parts = path.split("/").slice(2).map(decodeURIComponent);
  } catch {
    return null;
  }
  const [section, a, b, ...rest] = parts;
  if (section === undefined) return { section: "dashboard" };
  if (rest.length > 0) return null;
  if (section === "users" || section === "groups") {
    if (b !== undefined || (section === "groups" && a === undefined)) return null;
    return { section: "users", open: a === undefined ? null : { kind: section === "users" ? "person" : "group", id: a } };
  }
  if (section !== "links") return null;
  if (a === undefined) return { section: "links", open: null };
  if (a === "file" && b === undefined) return { section: "links-file" };
  if (a === "categories") return b === undefined ? null : { section: "links", open: { kind: "category", id: b } };
  return b === undefined ? { section: "links", open: { kind: "link", id: a } } : null;
}

/** Render the administration page of a canonical /admin path: admins only, unknown addresses not found. */
export function AdminRoutes({ path, user }: { path: string; user: User }) {
  if (user.role !== "admin") return <Forbidden />;
  const route = adminRoute(path);
  if (!route) return <NotFound />;
  switch (route.section) {
    case "dashboard":
      return <Dashboard />;
    case "users":
      return <PeoplePage me={user} open={route.open} />;
    case "links":
      return <LinksPage open={route.open} />;
    case "links-file":
      return <LinksFilePage />;
  }
}
