import type { Instance } from "./instance";

export type ApiErrorBody = {
  code: string;
  message: string;
  errors?: CatalogError[];
  attemptsLeft?: number;
  fields?: Record<string, string>;
  /** The item as stored now, with `item_changed`. */
  current?: unknown;
  /** The most pins a person may have, with `pins_full`. */
  max?: number;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
    /** Seconds to wait before trying again, from the Retry-After header of a refused attempt. */
    readonly retryAfter: number | null = null,
  ) {
    super(body.message);
  }
}

/** Return the delay a Retry-After header gives in seconds, or null when it holds none (absent, or a date). */
function retryAfterOf(res: Response): number | null {
  const value = res.headers.get("retry-after");
  if (value === null || !/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}

export type CatalogWarning =
  | { code: "no_group"; kind: "category" | "link"; id: string }
  | { code: "unknown_icon"; kind: "link"; id: string }
  | { code: "groups_differ_by_case"; groups: string[] };
export type CatalogErrorParams = { id?: string; key?: string; fields?: string[]; max?: number; line?: number };
export type CatalogError = { path: string; code: string; params: CatalogErrorParams };

export type CatalogDiff = {
  added: { categories: string[]; links: string[] };
  updated: { categories: string[]; links: string[] };
  removed: { categories: string[]; links: string[] };
  groupsCreated: string[];
  warnings: CatalogWarning[];
  /** Titles of the categories and links the diff lists or a warning names, with each link's category, and of the categories holding them. */
  labels: { categories: Record<string, string>; links: Record<string, { title: string; categoryId: string }> };
};
export type CatalogImport = { applied: boolean; diff: CatalogDiff; baseVersion: string };
/** What the catalog holds, and whether CATALOG_FILE manages it (import refused, groups it uses locked). */
export type CatalogState = { managedByFile: boolean; categories: number; links: number; groups: number };

export type Role = "admin" | "user";
export type GroupSource = "oidc" | "local" | "system";
export type AdminUser = {
  id: string;
  name: string;
  email: string;
  origin: "local" | "oidc";
  role: Role;
  roleSource: "local" | "override" | "provider";
  roleOverride: Role | null;
  disabled: boolean;
  mustChangePassword: boolean;
  groups: { id: string; name: string; source: GroupSource }[];
  lastSignInAt: string | null;
};
export type UserChanges = { name?: string; email?: string; role?: Role; roleOverride?: Role | null; disabled?: boolean };
export type AdminGroup = {
  id: string;
  name: string;
  source: GroupSource;
  memberIds: string[];
  categories: number;
  links: number;
  /** When a provider group last came in a sign-in token; null for one only typed (catalog, import) and never received. */
  seenAt: string | null;
};
/** A link as the catalog stores it: inactive links and links without a group included. */
export type AdminLink = {
  id: string;
  categoryId: string;
  title: string;
  description: string;
  url: string;
  icon: string | null;
  iconKnown: boolean;
  keywords: string[];
  active: boolean;
  /** Group references: `@everyone`, `@authenticated`, `local:<name>`, `oidc:<name>`. */
  groups: string[];
  revision: number;
};
export type AdminCategory = { id: string; title: string; groups: string[]; revision: number; links: AdminLink[] };
/** A point to know after a write that went through. */
export type EditWarning =
  | "no_group"
  | "unknown_icon"
  | "groups_differ_by_case"
  | "new_oidc_group"
  | "check_blocked_address"
  | "check_blocked_port"
  | "check_login_gateway";
export type LinkInput = {
  id?: string;
  categoryId: string;
  title: string;
  url: string;
  description?: string;
  /** `null` removes the icon. */
  icon?: string | null;
  keywords?: string[];
  groups: string[];
  active?: boolean;
};
export type CategoryInput = { id?: string; title: string; groups: string[] };
type Direction = "up" | "down";

/** Kinds of objects the change log names; `catalog` stands for a whole import. */
export type HistoryObjectType = "user" | "group" | "category" | "link" | "catalog";
export type HistoryAction = "create" | "update" | "delete" | "move" | "password_reset" | "member_add" | "member_remove" | "import";
/** An object an entry names, as it was then; `exists` says whether it is still there, to link to its page. */
export type HistoryObject = { type: HistoryObjectType; id: string | null; label: string | null; exists: boolean };
/** Who wrote an entry, name and e-mail as they were then; null in an entry for what YASAD did by itself. */
export type HistoryAuthor = { id: string; name: string | null; email: string | null; exists: boolean };
/** A snapshot of the fields an entry keeps (no secret ever), or an import's summary. */
export type HistorySnapshot = Record<string, unknown>;
export type HistoryEntry = {
  id: number;
  at: string;
  actor: HistoryAuthor | null;
  action: HistoryAction;
  object: HistoryObject;
  /** The person added to or removed from a group. */
  related: HistoryObject | null;
  before: HistorySnapshot | null;
  after: HistorySnapshot | null;
  /** An import's summary, or where a write without author came from (`source`: `setup`, `catalog_file`). */
  details: HistorySnapshot | null;
};
/** One page of the change log, newest first; `next` is the cursor of the following page. */
export type HistoryPage = { entries: HistoryEntry[]; next: number | null };
/**
 * Filters of the change log: `actor` is a person id or `none` for YASAD itself, `object` matches the object or the
 * related one, `from` (included) and `to` (excluded) are ISO instants, `before` is the cursor `next`.
 */
export type HistoryQuery = { actor?: string; type?: HistoryObjectType; object?: string; from?: string; to?: string; before?: number; limit?: number };
/** Someone who wrote entries still kept, deleted people included. */
export type HistoryActor = { id: string; name: string; email: string; exists: boolean };

/** Return the query string of a change log request, its keys in a fixed order and empty ones left out. */
export function historyQueryString(query: HistoryQuery): string {
  const params = new URLSearchParams();
  for (const key of ["actor", "type", "object", "from", "to", "before", "limit"] as const) {
    const value = query[key];
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export type SetupState = { open: boolean; setupCodeStillSet?: boolean };
export type User = { id: string; name: string; email: string; role: string; mustChangePassword?: boolean };
export type AdminInput = { name: string; email: string; password: string; passwordConfirm: string };

/** Icon of a link: a Simple Icons slug or a canonical Lucide name, both known to the generated icon files. */
export type HomeIcon = { set: "si" | "lucide"; name: string };
/** A visible link; `keywords` are sent as written in the catalog and only feed the search. */
export type HomeLink = { id: string; title: string; description: string; url: string; icon: HomeIcon | null; keywords: string[] };
export type HomeCategory = { id: string; title: string; links: HomeLink[] };
/** Why the home page is empty; set only when `categories` is empty and someone is signed in. */
export type HomeEmpty = "catalog_empty" | "admin_no_access" | "no_groups" | "nothing_visible";
/** `pins` lists the ids of the viewer's visible pinned links, in their order; empty when nobody is signed in. */
export type HomeData = { signedIn: boolean; categories: HomeCategory[]; empty: HomeEmpty | null; pins: string[] };

/** Error codes saying the session the app holds is out of date: signed out, temporary password set, or no longer an admin. */
const STALE_SESSION_CODES = new Set(["unauthenticated", "password_change_required", "forbidden"]);

let staleSessionListener: ((code: string) => void) | null = null;

/** Call `listener` whenever an API answer says the session has changed on the server; return the unsubscribe function. */
export function onStaleSession(listener: (code: string) => void): () => void {
  staleSessionListener = listener;
  return () => {
    if (staleSessionListener === listener) staleSessionListener = null;
  };
}

/**
 * Send a request to the API and return the response when its status is a success.
 *
 * Throws ApiError on an error status. YASAD routes answer `{ error: {...} }`; Better Auth answers `{ code, message }`.
 * An error code from STALE_SESSION_CODES is also reported to the onStaleSession listener.
 */
async function request(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: ApiErrorBody; code?: string; message?: string } | null;
    const err = new ApiError(res.status, data?.error ?? { code: data?.code ?? "unknown", message: data?.message ?? "" }, retryAfterOf(res));
    if (STALE_SESSION_CODES.has(err.body.code)) staleSessionListener?.(err.body.code);
    throw err;
  }
  return res;
}

/** Call the API and return the parsed body; see {@link request}. */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await request(path, init);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
// State-changing requests always carry a JSON body, even an empty one (see the same-origin check).
const send = (method: string, body: unknown = {}): RequestInit => ({ method, body: JSON.stringify(body) });

export const api = {
  instance: () => call<Instance>("/api/instance"),
  setupState: () => call<SetupState>("/api/setup"),
  verifyCode: (code: string) => call<void>("/api/setup/verify-code", post({ code })),
  completeSetup: (code: string, admin: AdminInput) => call<{ user: User }>("/api/setup", post({ code, ...admin })),
  home: () => call<HomeData>("/api/home"),
  session: async () => (await call<{ user: User } | null>("/api/auth/get-session"))?.user ?? null,
  signIn: (email: string, password: string) => call<unknown>("/api/auth/sign-in/email", post({ email, password })),
  /** Start the sign-in at the identity provider; `url` is its authorization page, `returnTo` the path to land on after. */
  signInWithProvider: (returnTo?: string) =>
    call<{ url: string }>("/api/auth/sign-in/social", post(returnTo === undefined ? {} : { returnTo })),
  /** End the session; `url`, when present, ends the session at the identity provider too. */
  signOut: () => call<{ success?: boolean; url?: string }>("/api/auth/sign-out", post({})),
  previewCatalog: (yaml: string) => call<CatalogImport>("/api/admin/catalog", post({ yaml, dryRun: true })),
  applyCatalog: (yaml: string, baseVersion: string) => call<CatalogImport>("/api/admin/catalog", post({ yaml, dryRun: false, baseVersion })),
  catalogState: () => call<CatalogState>("/api/admin/catalog/state"),
  /** Return the catalog file, as the YAML the import accepts. */
  exportCatalog: async () => (await request("/api/admin/catalog")).blob(),
  account: () => call<{ origin: "local" | "oidc" }>("/api/account"),
  updateProfile: (changes: { name?: string; email?: string; currentPassword?: string }) =>
    call<{ user: { id: string; name: string; email: string } }>("/api/account", send("PATCH", changes)),
  changePassword: (currentPassword: string, newPassword: string) =>
    call<void>("/api/account/password", post({ currentPassword, newPassword })),
  users: async () => (await call<{ users: AdminUser[] }>("/api/admin/users")).users,
  createUser: (input: { name: string; email: string; role: Role }) =>
    call<{ user: AdminUser; temporaryPassword: string }>("/api/admin/users", post(input)),
  updateUser: (id: string, changes: UserChanges) => call<{ user: AdminUser }>(`/api/admin/users/${encodeURIComponent(id)}`, send("PATCH", changes)),
  resetPassword: (id: string) => call<{ temporaryPassword: string }>(`/api/admin/users/${encodeURIComponent(id)}/password`, post({})),
  deleteUser: (id: string) => call<void>(`/api/admin/users/${encodeURIComponent(id)}`, send("DELETE")),
  groups: async () => (await call<{ groups: AdminGroup[] }>("/api/admin/groups")).groups,
  createGroup: (name: string) => call<{ group: AdminGroup }>("/api/admin/groups", post({ name })),
  renameGroup: (id: string, name: string) => call<{ group: AdminGroup }>(`/api/admin/groups/${encodeURIComponent(id)}`, send("PATCH", { name })),
  deleteGroup: (id: string) => call<void>(`/api/admin/groups/${encodeURIComponent(id)}`, send("DELETE")),
  addMember: (groupId: string, userId: string) =>
    call<void>(`/api/admin/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`, send("PUT")),
  removeMember: (groupId: string, userId: string) =>
    call<void>(`/api/admin/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`, send("DELETE")),
  /** Return the whole catalog as stored, to say what each group opens. */
  categories: async () => (await call<{ categories: AdminCategory[] }>("/api/admin/categories")).categories,
  createCategory: (input: CategoryInput) => call<{ category: AdminCategory; warnings: EditWarning[] }>("/api/admin/categories", post(input)),
  updateCategory: (id: string, revision: number, changes: Partial<CategoryInput>) =>
    call<{ category: AdminCategory; warnings: EditWarning[] }>(`/api/admin/categories/${encodeURIComponent(id)}`, send("PATCH", { revision, ...changes })),
  /** Move a category one step; `order` is the list of category ids after the move. */
  moveCategory: (id: string, direction: Direction) => call<{ order: string[] }>(`/api/admin/categories/${encodeURIComponent(id)}/move`, post({ direction })),
  /** Delete a category and its links; refused when it no longer holds `linkCount` links. */
  deleteCategory: (id: string, revision: number, linkCount: number) =>
    call<void>(`/api/admin/categories/${encodeURIComponent(id)}`, send("DELETE", { revision, linkCount })),
  createLink: (input: LinkInput) => call<{ link: AdminLink; warnings: EditWarning[] }>("/api/admin/links", post(input)),
  updateLink: (id: string, revision: number, changes: Partial<LinkInput>) =>
    call<{ link: AdminLink; warnings: EditWarning[] }>(`/api/admin/links/${encodeURIComponent(id)}`, send("PATCH", { revision, ...changes })),
  /** Move a link one step in its category; `order` is the list of that category's link ids after the move. */
  moveLink: (id: string, direction: Direction) => call<{ order: string[] }>(`/api/admin/links/${encodeURIComponent(id)}/move`, post({ direction })),
  deleteLink: (id: string, revision: number) => call<void>(`/api/admin/links/${encodeURIComponent(id)}`, send("DELETE", { revision })),
  /** Pin a visible link (already pinned is fine); `pins` is the viewer's list after the write. */
  pin: (linkId: string) => call<{ pins: string[] }>("/api/pins", post({ linkId })),
  /** Unpin a link; answers the list even when it was not pinned. */
  unpin: (linkId: string) => call<{ pins: string[] }>(`/api/pins/${encodeURIComponent(linkId)}`, send("DELETE")),
  /** Move a pin one step among the visible ones; the list is unchanged at either end. */
  movePin: (linkId: string, direction: Direction) =>
    call<{ pins: string[] }>(`/api/pins/${encodeURIComponent(linkId)}/move`, post({ direction })),
  history: (query: HistoryQuery = {}) => call<HistoryPage>(`/api/admin/history${historyQueryString(query)}`),
  historyActors: async () => (await call<{ actors: HistoryActor[] }>("/api/admin/history/actors")).actors,
};
