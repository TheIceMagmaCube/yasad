import type { User } from "../../api";
import { AdminShell, ADMIN_HOME } from "../../components/admin/AdminShell";
import { Forbidden, NotFound } from "../ErrorViews";
import { AdminCatalog } from "./AdminCatalog";
import { PeoplePage, type PeopleRoute } from "./people/PeoplePage";

/** What a canonical /admin path opens; `open` is the item whose page shows, or the wizard adding one. */
export type AdminRoute = { section: "users"; open: PeopleRoute } | { section: "catalog" };

/** Return the canonical form of an /admin path: the first section for /admin, the people table for /admin/groups. */
export function canonicalAdminPath(path: string): string {
  if (path === "/admin") return ADMIN_HOME;
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
  const [section, id, ...rest] = parts;
  if (rest.length > 0) return null;
  if (section === "catalog") return id === undefined ? { section: "catalog" } : null;
  if (section === "users") {
    if (id === undefined) return { section: "users", open: null };
    return { section: "users", open: id === "new" ? { kind: "new", type: "person" } : { kind: "person", id } };
  }
  if (section === "groups" && id !== undefined) {
    return { section: "users", open: id === "new" ? { kind: "new", type: "group" } : { kind: "group", id } };
  }
  return null;
}

/** Render the administration page of a canonical /admin path: admins only, unknown addresses not found. */
export function AdminRoutes({ path, user }: { path: string; user: User }) {
  if (user.role !== "admin") return <Forbidden />;
  const route = adminRoute(path);
  if (!route) return <NotFound />;
  if (route.section === "catalog") {
    return (
      <AdminShell section="catalog">
        <AdminCatalog />
      </AdminShell>
    );
  }
  return <PeoplePage me={user} open={route.open} />;
}
