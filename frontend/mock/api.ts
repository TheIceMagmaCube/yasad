// In-memory stand-in for the YASAD API, for the admin prototype: realistic data (12 people, 10 groups, 4 categories,
// 15 links), writes applied to memory. Used by the Vite dev server when YASAD_MOCK=1 and by the screenshot harness.
// Not a model of the server: checks are the few the screens rely on (revision conflicts, last admin left alone).

type Source = "local" | "oidc" | "system";
type Group = { id: string; name: string; source: Source; seenAt?: string | null };
type User = {
  id: string;
  name: string;
  email: string;
  origin: "local" | "oidc";
  role: "admin" | "user";
  roleSource: "local" | "override" | "provider";
  roleOverride: "admin" | "user" | null;
  disabled: boolean;
  mustChangePassword: boolean;
  groupIds: string[];
  lastSignInAt: string | null;
};
type Link = {
  id: string;
  categoryId: string;
  title: string;
  description: string;
  url: string;
  icon: string | null;
  keywords: string[];
  active: boolean;
  groups: string[];
  revision: number;
};
type Category = { id: string; title: string; groups: string[]; revision: number };

export type MockResponse = { status: number; body?: unknown; type?: string };

/** Icons the prototype treats as unknown to this version; every other well-formed one is known. */
const UNKNOWN_ICONS = new Set(["si:helpdesk-pro"]);
const ICON = /^(si:[a-z0-9_-]+|lucide:[a-z0-9-]+)$/;

const refOf = (g: Group) => (g.source === "system" ? `@${g.name}` : `${g.source}:${g.name}`);
const error = (status: number, code: string, extra: Record<string, unknown> = {}): MockResponse => ({ status, body: { error: { code, message: code, ...extra } } });
const ok = (body: unknown, status = 200): MockResponse => ({ status, body });
const slug = (title: string) =>
  title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "item";

/** Return a fresh mock API whose dates are relative to `now`. */
export function createMockApi({ now = Date.now(), theme = "default" }: { now?: number; theme?: string } = {}) {
  const ago = (hours: number) => new Date(now - hours * 3600_000).toISOString();
  let revision = 1;
  let counter = 100;

  const groups: Group[] = [
    { id: "g-everyone", name: "everyone", source: "system" },
    { id: "g-auth", name: "authenticated", source: "system" },
    { id: "g-it", name: "IT team", source: "local" },
    { id: "g-fin", name: "Finance", source: "local" },
    { id: "g-mgr", name: "Managers", source: "local" },
    { id: "g-int", name: "Interns", source: "local" },
    { id: "g-sup", name: "Support", source: "local" },
    { id: "g-staff", name: "staff", source: "oidc", seenAt: ago(0.2) },
    { id: "g-eng", name: "engineering", source: "oidc", seenAt: ago(26) },
    { id: "g-hr", name: "hr", source: "oidc", seenAt: ago(5) },
    // Typed in the catalog, never received in a sign-in token.
    { id: "g-ctr", name: "contractors", source: "oidc", seenAt: null },
  ];
  const user = (id: string, name: string, email: string, origin: "local" | "oidc", groupIds: string[], extra: Partial<User> = {}): User => ({
    id,
    name,
    email: `${email}@example.invalid`,
    origin,
    role: "user",
    roleSource: origin === "local" ? "local" : "provider",
    roleOverride: null,
    disabled: false,
    mustChangePassword: false,
    groupIds,
    lastSignInAt: ago(3),
    ...extra,
  });
  let users: User[] = [
    user("u1", "Camille Durand", "camille.durand", "local", ["g-it", "g-mgr"], { role: "admin", lastSignInAt: ago(0.2) }),
    user("u2", "Alexandre Martin", "alexandre.martin", "oidc", ["g-staff", "g-eng", "g-it"], { role: "admin", roleSource: "override", roleOverride: "admin", lastSignInAt: ago(26) }),
    user("u3", "Sophie Bernard", "sophie.bernard", "oidc", ["g-staff", "g-hr", "g-mgr"], { lastSignInAt: ago(5) }),
    user("u4", "Lucas Petit", "lucas.petit", "oidc", ["g-staff", "g-eng"], { lastSignInAt: ago(50) }),
    user("u5", "Emma Robert", "emma.robert", "oidc", ["g-staff", "g-fin"], { lastSignInAt: ago(2) }),
    user("u6", "Hugo Richard", "hugo.richard", "local", ["g-int"], { mustChangePassword: true, lastSignInAt: null }),
    user("u7", "Léa Moreau", "lea.moreau", "oidc", ["g-staff", "g-eng"], { lastSignInAt: ago(120) }),
    user("u8", "Thomas Laurent", "thomas.laurent", "local", ["g-fin", "g-mgr"], { disabled: true, lastSignInAt: ago(24 * 60) }),
    user("u9", "Chloé Simon", "chloe.simon", "oidc", ["g-staff", "g-hr"], { lastSignInAt: ago(8) }),
    user("u10", "Nathan Michel", "nathan.michel", "oidc", ["g-staff", "g-eng"], { lastSignInAt: ago(30) }),
    user("u11", "Manon Lefebvre", "manon.lefebvre", "local", ["g-fin"], { lastSignInAt: ago(72) }),
    user("u12", "Kiosk reception", "kiosk", "local", [], { lastSignInAt: ago(1) }),
  ];

  let categories: Category[] = [
    { id: "daily", title: "Daily work", groups: ["@authenticated"], revision: 1 },
    { id: "eng", title: "Engineering", groups: ["oidc:engineering", "local:IT team"], revision: 1 },
    { id: "finance", title: "Finance and purchasing", groups: ["local:Finance", "local:Managers"], revision: 1 },
    { id: "help", title: "Help", groups: ["@everyone"], revision: 1 },
  ];
  const link = (categoryId: string, id: string, title: string, description: string, url: string, icon: string | null, groupRefs: string[], keywords: string[] = [], active = true): Link => ({
    id,
    categoryId,
    title,
    description,
    url,
    icon,
    keywords,
    active,
    groups: groupRefs,
    revision: 1,
  });
  let links: Link[] = [
    link("daily", "mail", "Mail", "Company webmail", "https://mail.example.invalid", "lucide:mail", ["@authenticated"], ["email", "webmail"]),
    link("daily", "calendar", "Calendar", "Meetings and room booking", "https://cal.example.invalid", "lucide:calendar", ["@authenticated"], ["agenda", "rooms"]),
    link("daily", "drive", "Drive", "Shared documents and spreadsheets", "https://drive.example.invalid", "si:google", ["oidc:staff", "local:Managers"], ["docs", "sheets"]),
    link("daily", "files", "Nextcloud", "Team files and photo sharing", "https://cloud.example.invalid", "si:nextcloud", ["oidc:staff"], ["files"]),
    link("daily", "wiki", "Handbook", "Procedures, onboarding, who does what", "https://wiki.example.invalid", "lucide:book-open", ["@authenticated"], ["wiki", "docs"]),
    link("eng", "gitlab", "GitLab", "Source code, merge requests and CI", "https://git.example.invalid", "si:gitlab", ["oidc:engineering"], ["git", "ci"]),
    link("eng", "jira", "Jira", "Backlog and sprints", "https://jira.example.invalid", "si:jira", ["oidc:engineering", "oidc:contractors", "local:IT team"], ["tickets"]),
    link("eng", "grafana", "Grafana", "Dashboards and alerts", "https://grafana.example.invalid", "si:grafana", ["local:IT team", "oidc:engineering"], ["metrics", "monitoring"]),
    link("eng", "proxmox", "Proxmox", "Virtual machines of the server room", "https://pve.example.invalid", "si:proxmox", ["local:IT team"], ["vm"]),
    link("eng", "portainer", "Portainer", "Containers", "https://portainer.example.invalid", "si:portainer", ["local:IT team"], ["docker"], false),
    link("finance", "shop", "Purchase requests", "Order equipment and supplies", "https://buy.example.invalid", "lucide:shopping-cart", ["local:Finance", "local:Managers", "oidc:staff"], ["order", "supplies"]),
    link("finance", "expenses", "Expenses", "Submit receipts for refund", "https://expenses.example.invalid", "lucide:receipt", ["@authenticated"], ["refund"]),
    link("finance", "payroll", "Payroll", "", "https://payroll.example.invalid", "lucide:wallet", [], ["salary"]),
    link("help", "vault", "Bitwarden", "Shared passwords of the team", "https://vault.example.invalid", "si:bitwarden", ["local:IT team"], ["passwords"]),
    link("help", "support", "IT support", "Open a ticket with the IT team", "https://support.example.invalid", "si:helpdesk-pro", ["@everyone"], ["ticket", "helpdesk"]),
  ];

  const groupById = (id: string) => groups.find((g) => g.id === id);
  const adminUser = (u: User) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    origin: u.origin,
    role: u.role,
    roleSource: u.roleSource,
    roleOverride: u.roleOverride,
    disabled: u.disabled,
    mustChangePassword: u.mustChangePassword,
    groups: u.groupIds.map(groupById).filter((g): g is Group => Boolean(g)),
    lastSignInAt: u.lastSignInAt,
  });
  const adminGroup = (g: Group) => {
    const ref = refOf(g);
    return {
      ...g,
      seenAt: g.source === "oidc" ? (g.seenAt ?? null) : null,
      memberIds: g.source === "system" ? [] : users.filter((u) => u.groupIds.includes(g.id)).map((u) => u.id),
      categories: categories.filter((c) => c.groups.includes(ref)).length,
      links: links.filter((l) => l.groups.includes(ref)).length,
    };
  };
  const adminLink = (l: Link) => ({ ...l, iconKnown: l.icon !== null && ICON.test(l.icon) && !UNKNOWN_ICONS.has(l.icon) });
  const adminCategory = (c: Category) => ({ ...c, links: links.filter((l) => l.categoryId === c.id).map(adminLink) });

  /** Return the warnings of a write citing `refs`, creating the provider groups that do not exist yet. */
  const groupWarnings = (refs: string[], icon?: string | null) => {
    const warnings: string[] = [];
    if (refs.length === 0) warnings.push("no_group");
    if (icon && (!ICON.test(icon) || UNKNOWN_ICONS.has(icon))) warnings.push("unknown_icon");
    for (const ref of refs) {
      if (groups.some((g) => refOf(g) === ref)) continue;
      if (ref.startsWith("oidc:")) {
        groups.push({ id: `g-${++counter}`, name: ref.slice(5), source: "oidc", seenAt: null });
        if (!warnings.includes("new_oidc_group")) warnings.push("new_oidc_group");
      } else return { unknown: true, warnings };
    }
    return { unknown: false, warnings };
  };

  const home = () => ({
    signedIn: true,
    empty: null,
    categories: categories.map((c) => ({
      id: c.id,
      title: c.title,
      links: links
        .filter((l) => l.categoryId === c.id && l.active)
        .map((l) => {
          const [set, name] = (l.icon ?? "").split(":");
          return { id: l.id, title: l.title, description: l.description, url: l.url, icon: l.icon ? { set, name } : null, keywords: l.keywords };
        }),
    })),
  });

  /** Move `id` one place in `list` (ids in order); return the new order. */
  const swap = <T extends { id: string }>(list: T[], id: string, direction: "up" | "down"): T[] => {
    const i = list.findIndex((x) => x.id === id);
    const j = direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
  };

  function handle(method: string, path: string, body: Record<string, unknown> = {}): MockResponse | null {
    const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
    if (parts[0] !== "api") return null;
    const route = `${method} /${parts.slice(1).join("/")}`;
    const me = users.find((u) => u.id === "u1")!;
    switch (route) {
      case "GET /instance":
        return ok({ title: "Acme intranet", logo: null, theme, defaultLanguage: "fr", passwordSignIn: true, oidc: { name: "Authentik" } });
      case "GET /setup":
        return ok({ open: false });
      case "GET /auth/get-session":
        return ok({ user: { id: me.id, name: me.name, email: me.email, role: me.role, mustChangePassword: false }, session: { id: "s1" } });
      case "POST /auth/sign-out":
        return ok({ success: true });
      case "GET /home":
        return ok(home());
      case "GET /account":
        return ok({ origin: "local" });
      case "PATCH /account":
        if (typeof body.name === "string" && body.name.trim()) me.name = body.name.trim();
        if (typeof body.email === "string" && body.email.trim()) me.email = body.email.trim().toLowerCase();
        return ok({ user: { id: me.id, name: me.name, email: me.email } });
      case "POST /account/password":
        return { status: 204 };
      case "GET /admin/users":
        return ok({ users: users.map(adminUser) });
      case "POST /admin/users": {
        const u = user(`u${++counter}`, String(body.name ?? "").trim(), "x", "local", [], {
          email: String(body.email ?? "").trim().toLowerCase(),
          role: body.role === "admin" ? "admin" : "user",
          mustChangePassword: true,
          lastSignInAt: null,
        });
        if (!u.name) return error(422, "invalid_input", { fields: { name: "invalid_name" } });
        if (users.some((x) => x.email === u.email)) return error(422, "invalid_input", { fields: { email: "email_taken" } });
        users.push(u);
        return ok({ user: adminUser(u), temporaryPassword: "Lumen-Pebble-4821" }, 201);
      }
      case "GET /admin/groups":
        return ok({ groups: groups.map(adminGroup) });
      case "POST /admin/groups": {
        const name = String(body.name ?? "").trim();
        if (!name) return error(422, "invalid_input", { fields: { name: "invalid_name" } });
        if (groups.some((g) => g.source === "local" && g.name.toLowerCase() === name.toLowerCase())) return error(422, "invalid_input", { fields: { name: "name_taken" } });
        const g: Group = { id: `g-${++counter}`, name, source: "local" };
        groups.push(g);
        return ok({ group: adminGroup(g) }, 201);
      }
      case "GET /admin/catalog/state":
        return ok({ managedByFile: false, categories: categories.length, links: links.length, groups: new Set([...categories, ...links].flatMap((x) => x.groups)).size });
      case "GET /admin/catalog":
        return { status: 200, type: "application/yaml", body: "version: 1\ncategories: []\n" };
      case "POST /admin/catalog":
        return ok({
          applied: false,
          baseVersion: "v1",
          diff: { added: { categories: [], links: [] }, updated: { categories: [], links: [] }, removed: { categories: [], links: [] }, groupsCreated: [], warnings: [], labels: { categories: {}, links: {} } },
        });
      case "GET /admin/categories":
        return ok({ categories: categories.map(adminCategory) });
      case "POST /admin/categories": {
        const title = String(body.title ?? "").trim();
        if (!title) return error(422, "invalid_input", { fields: { title: "required" } });
        const refs = (body.groups as string[]) ?? [];
        const checked = groupWarnings(refs);
        if (checked.unknown) return error(409, "unknown_group");
        let id = slug(title);
        while (categories.some((c) => c.id === id)) id = `${id}-2`;
        const c: Category = { id, title, groups: refs, revision: ++revision };
        categories.push(c);
        return ok({ category: adminCategory(c), warnings: checked.warnings }, 201);
      }
      case "POST /admin/links": {
        const title = String(body.title ?? "").trim();
        if (!title) return error(422, "invalid_input", { fields: { title: "required" } });
        if (!/^https?:\/\//.test(String(body.url ?? ""))) return error(422, "invalid_input", { fields: { url: "invalid_url" } });
        const refs = (body.groups as string[]) ?? [];
        const checked = groupWarnings(refs, body.icon as string | undefined);
        if (checked.unknown) return error(409, "unknown_group");
        let id = slug(title);
        while (links.some((l) => l.id === id)) id = `${id}-2`;
        const l: Link = {
          id,
          categoryId: String(body.categoryId),
          title,
          description: String(body.description ?? ""),
          url: String(body.url),
          icon: (body.icon as string | undefined) ?? null,
          keywords: (body.keywords as string[]) ?? [],
          active: body.active !== false,
          groups: refs,
          revision: ++revision,
        };
        links.push(l);
        return ok({ link: adminLink(l), warnings: checked.warnings }, 201);
      }
    }

    // Routes with an id.
    const [, area, id, sub, subId] = parts;
    if (area === "admin" && id === "users" && sub) {
      const u = users.find((x) => x.id === sub);
      if (!u) return error(404, "not_found");
      if (method === "PATCH" && !subId) {
        if (u.id === me.id && ("role" in body || "disabled" in body)) return error(403, "cannot_change_self");
        if (typeof body.name === "string") u.name = body.name.trim();
        if (typeof body.email === "string" && u.origin === "local") u.email = body.email.trim().toLowerCase();
        if (body.role === "admin" || body.role === "user") u.role = body.role;
        if ("roleOverride" in body) {
          u.roleOverride = (body.roleOverride as User["roleOverride"]) ?? null;
          u.roleSource = u.roleOverride ? "override" : "provider";
          u.role = u.roleOverride ?? "user";
        }
        if (typeof body.disabled === "boolean") u.disabled = body.disabled;
        return ok({ user: adminUser(u) });
      }
      if (method === "POST" && subId === "password") {
        if (u.origin !== "local") return error(409, "no_local_password");
        u.mustChangePassword = true;
        return ok({ temporaryPassword: "Cobalt-Meadow-7390" });
      }
      if (method === "DELETE" && !subId) {
        if (u.id === me.id) return error(403, "cannot_change_self");
        users = users.filter((x) => x.id !== u.id);
        return { status: 204 };
      }
    }
    if (area === "admin" && id === "groups" && sub) {
      const g = groups.find((x) => x.id === sub);
      if (!g) return error(404, "not_found");
      const [, , , , , memberId] = parts;
      if (subId === "members" && memberId) {
        if (g.source !== "local") return error(409, "read_only_group");
        const u = users.find((x) => x.id === memberId);
        if (!u) return error(404, "not_found");
        if (method === "PUT" && !u.groupIds.includes(g.id)) u.groupIds.push(g.id);
        if (method === "DELETE") u.groupIds = u.groupIds.filter((x) => x !== g.id);
        return { status: 204 };
      }
      if (g.source !== "local") return error(409, "read_only_group");
      if (method === "PATCH") {
        const before = refOf(g);
        g.name = String(body.name ?? "").trim() || g.name;
        const after = refOf(g);
        for (const item of [...categories, ...links]) item.groups = item.groups.map((r) => (r === before ? after : r));
        return ok({ group: adminGroup(g) });
      }
      if (method === "DELETE") {
        const ref = refOf(g);
        groups.splice(groups.indexOf(g), 1);
        for (const u of users) u.groupIds = u.groupIds.filter((x) => x !== g.id);
        for (const item of [...categories, ...links]) item.groups = item.groups.filter((r) => r !== ref);
        return { status: 204 };
      }
    }
    if (area === "admin" && id === "categories" && sub) {
      const c = categories.find((x) => x.id === sub);
      if (!c) return error(404, "not_found");
      if (method === "POST" && subId === "move") {
        categories = swap(categories, c.id, body.direction === "up" ? "up" : "down");
        revision++;
        return ok({ order: categories.map((x) => x.id) });
      }
      if (body.revision !== c.revision) return error(409, "item_changed", { current: adminCategory(c) });
      if (method === "PATCH") {
        const refs = (body.groups as string[] | undefined) ?? c.groups;
        const checked = groupWarnings(refs);
        if (checked.unknown) return error(409, "unknown_group");
        if (typeof body.title === "string") c.title = body.title.trim();
        c.groups = refs;
        c.revision = ++revision;
        return ok({ category: adminCategory(c), warnings: checked.warnings });
      }
      if (method === "DELETE") {
        categories = categories.filter((x) => x.id !== c.id);
        links = links.filter((l) => l.categoryId !== c.id);
        return { status: 204 };
      }
    }
    if (area === "admin" && id === "links" && sub) {
      const l = links.find((x) => x.id === sub);
      if (!l) return error(404, "not_found");
      if (method === "POST" && subId === "move") {
        const siblings = links.filter((x) => x.categoryId === l.categoryId);
        const moved = swap(siblings, l.id, body.direction === "up" ? "up" : "down");
        links = [...links.filter((x) => x.categoryId !== l.categoryId), ...moved];
        revision++;
        return ok({ order: moved.map((x) => x.id) });
      }
      if (body.revision !== l.revision) return error(409, "item_changed", { current: adminLink(l) });
      if (method === "PATCH") {
        const refs = (body.groups as string[] | undefined) ?? l.groups;
        const icon = "icon" in body ? ((body.icon as string | null) ?? null) : l.icon;
        const checked = groupWarnings(refs, icon);
        if (checked.unknown) return error(409, "unknown_group");
        Object.assign(l, {
          title: typeof body.title === "string" ? body.title.trim() : l.title,
          url: typeof body.url === "string" ? body.url.trim() : l.url,
          description: typeof body.description === "string" ? body.description.trim() : l.description,
          keywords: (body.keywords as string[] | undefined) ?? l.keywords,
          active: typeof body.active === "boolean" ? body.active : l.active,
          icon,
          groups: refs,
          revision: ++revision,
        });
        if (typeof body.categoryId === "string" && body.categoryId !== l.categoryId) {
          links = [...links.filter((x) => x.id !== l.id), { ...l, categoryId: body.categoryId }];
          return ok({ link: adminLink(links[links.length - 1]!), warnings: checked.warnings });
        }
        return ok({ link: adminLink(l), warnings: checked.warnings });
      }
      if (method === "DELETE") {
        links = links.filter((x) => x.id !== l.id);
        return { status: 204 };
      }
    }
    return error(404, "not_found");
  }

  return { handle };
}
