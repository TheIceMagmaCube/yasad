import type { Instance } from "./instance";

export type ApiErrorBody = {
  code: string;
  message: string;
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

export type SetupState = { open: boolean; setupCodeStillSet?: boolean };
export type User = { name: string; email: string; role: string; mustChangePassword?: boolean };
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

export const api = {
  instance: () => call<Instance>("/api/instance"),
  setupState: () => call<SetupState>("/api/setup"),
  verifyCode: (code: string) => call<void>("/api/setup/verify-code", post({ code })),
  completeSetup: (code: string, admin: AdminInput) => call<{ user: User }>("/api/setup", post({ code, ...admin })),
  session: async () => (await call<{ user: User } | null>("/api/auth/get-session"))?.user ?? null,
  signIn: (email: string, password: string) => call<unknown>("/api/auth/sign-in/email", post({ email, password })),
  signOut: () => call<unknown>("/api/auth/sign-out", post({})),
  changePassword: (currentPassword: string, newPassword: string) =>
    call<void>("/api/account/password", post({ currentPassword, newPassword })),
};
