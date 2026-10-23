import type { User } from "../../api";
import { Forbidden, NotFound } from "../ErrorViews";
import { HistoryPage } from "./history/HistoryPage";
import { Dashboard } from "./Dashboard";
import { LinksFilePage, LinksPage, type LinksRoute } from "./links/LinksPage";
import { PeoplePage, type PeopleRoute } from "./people/PeoplePage";

/** What a canonical /admin path opens; `open` is the item whose page shows, or the wizard adding one. */
export type AdminRoute =
  | { section: "dashboard" }
  | { section: "users"; open: PeopleRoute }
  | { section: "links"; open: LinksRoute }
  | { section: "links-file" }
  | { section: "history" };

/** Address of the YAML import and export, which /admin/catalog used to be. */
export const LINKS_FILE = "/admin/links/file";

/** Return the canonical form of an /admin path: the people table for /admin/groups, the YAML file page for the former catalog page. */
export function canonicalAdminPath(path: string): string {
  if (path === "/admin/catalog") return LINKS_FILE;
  // People and groups are one section: the groups are a filter of the people table.
  if (path === "/admin/groups") return "/admin/users";
  return path;
}

/** Return the route of a canonical /admin path, or null for an address that opens nothing. */
export function adminRoute(path: string): AdminRoute | null {
  let parts: string[];
  try {
    parts = path.split("/").slice(2).map(decodeURIComponent);
  } catch {
    return null;
  }
  if (parts[0] === "links") return linksRoute(parts.slice(1));
  if (parts[0] === "history") return parts.length === 1 ? { section: "history" } : null;
  const [section, id, ...rest] = parts;
  if (section === undefined) return { section: "dashboard" };
  if (section === "users" && id !== undefined && id !== "new" && rest.length === 1 && rest[0] === "home") {
    return { section: "users", open: { kind: "preview", id } };
  }
  if (rest.length > 0) return null;
  if (section === "users") {
    if (id === undefined) return { section: "users", open: null };
    return { section: "users", open: id === "new" ? { kind: "new", type: "person" } : { kind: "person", id } };
  }
  if (section === "groups" && id !== undefined) {
    return { section: "users", open: id === "new" ? { kind: "new", type: "group" } : { kind: "group", id } };
  }
  return null;
}

/** Return the route of the parts of a path after /admin/links. */
function linksRoute([a, b, ...rest]: string[]): AdminRoute | null {
  if (rest.length > 0) return null;
  if (a === undefined) return { section: "links", open: null };
  if (a === "file") return b === undefined ? { section: "links-file" } : null;
  if (a === "new") return b === undefined ? { section: "links", open: { kind: "new", type: "link" } } : null;
  // Two segments, as no link page has: a link whose id is "visitor" keeps its page.
  if (a === "visitor" && b === "home") return { section: "links", open: { kind: "visitor" } };
  if (a === "categories") {
    if (b === undefined) return null;
    return { section: "links", open: b === "new" ? { kind: "new", type: "category" } : { kind: "category", id: b } };
  }
  return b === undefined ? { section: "links", open: { kind: "link", id: a } } : null;
}

/** Render the administration page of a canonical /admin path: admins only, unknown addresses not found. */
export function AdminRoutes({ path, user }: { path: string; user: User }) {
  if (user.role !== "admin") return <Forbidden />;
  const route = adminRoute(path);
  if (!route) return <NotFound />;
  if (route.section === "dashboard") return <Dashboard />;
  if (route.section === "links") return <LinksPage open={route.open} />;
  if (route.section === "links-file") return <LinksFilePage />;
  if (route.section === "history") return <HistoryPage />;
  return <PeoplePage me={user} open={route.open} />;
}
