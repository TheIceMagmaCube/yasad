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

export type CatalogWarning = { code: "no_group"; kind: "category" | "link"; id: string } | { code: "groups_differ_by_case"; groups: string[] };
export type CatalogErrorParams = { id?: string; key?: string; fields?: string[]; max?: number; line?: number };
export type CatalogError = { path: string; code: string; params: CatalogErrorParams };

export type CatalogDiff = {
  added: { categories: string[]; links: string[] };
  updated: { categories: string[]; links: string[] };
  removed: { categories: string[]; links: string[] };
  groupsCreated: string[];
  warnings: CatalogWarning[];
};
export type CatalogImport = { applied: boolean; diff: CatalogDiff; baseVersion: string };

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
export type UserChanges = { name?: string; role?: Role; roleOverride?: Role | null; disabled?: boolean };
export type AdminGroup = { id: string; name: string; source: GroupSource; memberIds: string[]; categories: number; links: number };

export type SetupState = { open: boolean; setupCodeStillSet?: boolean };
export type User = { id: string; name: string; email: string; role: string; mustChangePassword?: boolean };
export type AdminInput = { name: string; email: string; password: string; passwordConfirm: string };

/**
 * Call the API and return the parsed body.
 *
 * Throws ApiError on an error status. YASAD routes answer `{ error: {...} }`; Better Auth answers `{ code, message }`.
 */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: ApiErrorBody; code?: string; message?: string } | null;
    throw new ApiError(res.status, data?.error ?? { code: data?.code ?? "unknown", message: data?.message ?? "" });
  }
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
  session: async () => (await call<{ user: User } | null>("/api/auth/get-session"))?.user ?? null,
  signIn: (email: string, password: string) => call<unknown>("/api/auth/sign-in/email", post({ email, password })),
  signOut: () => call<unknown>("/api/auth/sign-out", post({})),
  previewCatalog: (yaml: string) => call<CatalogImport>("/api/admin/catalog", post({ yaml, dryRun: true })),
  applyCatalog: (yaml: string, baseVersion: string) => call<CatalogImport>("/api/admin/catalog", post({ yaml, dryRun: false, baseVersion })),
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
