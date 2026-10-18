import type { ReactNode } from "react";

import type { User } from "../../api";
import { Forbidden, NotFound } from "../ErrorViews";
import { AdminCatalog } from "./AdminCatalog";
import { AdminGroups } from "./AdminGroups";
import { adminTab, AdminLayout, type AdminTab } from "./AdminLayout";
import { AdminUsers } from "./AdminUsers";

/** Page of each administration section; a section without one fails the type check. */
const PAGES: { [T in AdminTab]: (me: User) => ReactNode } = {
  users: (me) => <AdminUsers me={me} />,
  groups: () => <AdminGroups />,
  catalog: () => <AdminCatalog />,
};

/** Render the administration page of a canonical /admin path: admins only, unknown sections not found. */
export function AdminRoutes({ path, user }: { path: string; user: User }) {
  if (user.role !== "admin") return <Forbidden />;
  const tab = adminTab(path);
  if (!tab) return <NotFound />;
  return <AdminLayout tab={tab}>{PAGES[tab](user)}</AdminLayout>;
}
