import type { Instance } from "./instance";

export type ApiErrorBody = {
  code: string;
  message: string;
  errors?: CatalogError[];
  attemptsLeft?: number;
  fields?: Record<string, string>;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }
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
export type AdminGroup = { id: string; name: string; source: GroupSource; memberIds: string[]; categories: number; links: number };

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
export type HomeData = { signedIn: boolean; categories: HomeCategory[]; empty: HomeEmpty | null };

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
    const err = new ApiError(res.status, data?.error ?? { code: data?.code ?? "unknown", message: data?.message ?? "" });
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
  signOut: () => call<unknown>("/api/auth/sign-out", post({})),
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
};
