import { renderHook } from "@testing-library/react";

import type { AdminCategory, AdminLink, CatalogState, CheckSettings, HomeData } from "../../../api";
import { primeHome, useHomeEntry } from "../../../lib/home-store";
import type { Routes } from "../../../test-utils";
import { group, groupsAnswer, person, usersAnswer } from "../people/testing";

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

/** Check settings of a Docker instance with the default interval and no checked link. */
export const CHECKS: CheckSettings = { intervalMinutes: 5, staleAfterMinutes: 15, checked: 0, capacity: null };
export const STATE: CatalogState = { managedByFile: false, categories: 3, links: 4, groups: 3, checks: CHECKS };

export const BOB = person({ id: "bob", name: "Bob", groups: [{ id: "g1", name: "Finance", source: "local" }] });
export const KEN = person({ id: "ken", name: "Ken", origin: "oidc" });

/** Who sees an item: `people` active accounts, and a visitor when `public`. */
export const audienceAnswer = (people: number, isPublic = false) => ({ status: 200, body: { audience: { people, public: isPublic } } });

/**
 * The answers the links section loads, `extra` added or replacing them: the item pages read who sees each link and
 * category of `categories`, and the people a link can be explained for.
 */
export const linksRoutes = (extra: Routes = {}, { categories = [TOOLS, DEV, EMPTY], state = STATE } = {}): Routes => ({
  "GET /api/admin/categories": { status: 200, body: { categories } },
  "GET /api/admin/groups": groupsAnswer(...GROUPS),
  "GET /api/admin/catalog/state": { status: 200, body: state },
  "GET /api/admin/users": usersAnswer(BOB, KEN),
  ...Object.fromEntries(categories.map((c) => [`GET /api/admin/access/categories/${c.id}`, audienceAnswer(2)])),
  ...Object.fromEntries(categories.flatMap((c) => c.links).map((l) => [`GET /api/admin/access/links/${l.id}`, audienceAnswer(2)])),
  ...extra,
});

/**
 * Put an answer in the home cache; the function returned says whether that same answer is still there, so a write
 * of another one in its place counts as gone.
 */
export function primeHomeCache(): () => boolean {
  const primed: HomeData = { signedIn: true, categories: [], empty: null, pins: [] };
  primeHome("user:ada", primed);
  const cached = renderHook(() => useHomeEntry("user:ada")).result;
  return () => {
    const state = cached.current?.state;
    return state?.status === "ready" && state.data === primed;
  };
}
