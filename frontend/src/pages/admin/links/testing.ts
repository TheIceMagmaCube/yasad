import { renderHook } from "@testing-library/react";

import type { AdminCategory, AdminLink, CatalogState } from "../../../api";
import { primeHome, useHomeEntry } from "../../../lib/home-store";
import type { Routes } from "../../../test-utils";
import { group, groupsAnswer } from "../people/testing";

export const link = (fields: Partial<AdminLink> & { id: string; title: string }): AdminLink => ({
  categoryId: "tools",
  description: "",
  url: `https://${fields.id}.example.invalid/start`,
  icon: null,
  iconKnown: false,
  keywords: [],
  active: true,
  check: false,
  status: null,
  groups: ["@authenticated"],
  revision: 1,
  ...fields,
});

export const category = (fields: Partial<AdminCategory> & { id: string; title: string }): AdminCategory => ({
  groups: ["@authenticated"],
  revision: 1,
  links: [],
  ...fields,
});

export const WIKI = link({ id: "wiki", title: "Wiki", icon: "lucide:book", iconKnown: true, keywords: ["docs"] });
export const MAIL = link({ id: "mail", title: "Mail", groups: [] });
export const OLD = link({ id: "old", title: "Old intranet", active: false });
export const GIT = link({ id: "git", title: "Git", categoryId: "dev", groups: ["oidc:auditors"], icon: "si:nope", iconKnown: false });
export const TOOLS = category({ id: "tools", title: "Tools", links: [WIKI, MAIL, OLD] });
export const DEV = category({ id: "dev", title: "Development", groups: [], links: [GIT] });
export const EMPTY = category({ id: "empty", title: "Empty shelf" });

export const GROUPS = [
  group({ id: "system:everyone", name: "everyone", source: "system" }),
  group({ id: "system:authenticated", name: "authenticated", source: "system" }),
  group({ id: "g1", name: "Finance" }),
  group({ id: "o1", name: "developers", source: "oidc", seenAt: "2026-10-01T00:00:00.000Z" }),
  group({ id: "o2", name: "auditors", source: "oidc", seenAt: null }),
];

export const STATE: CatalogState = { managedByFile: false, categories: 3, links: 4, groups: 3 };

/** The answers the links section loads, `extra` added or replacing them. */
export const linksRoutes = (extra: Routes = {}, { categories = [TOOLS, DEV, EMPTY], state = STATE } = {}): Routes => ({
  "GET /api/admin/categories": { status: 200, body: { categories } },
  "GET /api/admin/groups": groupsAnswer(...GROUPS),
  "GET /api/admin/catalog/state": { status: 200, body: state },
  ...extra,
});

/** Put an answer in the home cache; the function returned says whether it is still there. */
export function primeHomeCache(): () => boolean {
  primeHome("user:ada", { signedIn: true, categories: [], empty: null, pins: [] });
  const cached = renderHook(() => useHomeEntry("user:ada")).result;
  return () => cached.current !== null;
}
