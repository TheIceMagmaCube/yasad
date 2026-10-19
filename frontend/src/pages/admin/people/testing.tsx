import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AdminGroup, AdminUser, User } from "../../../api";
import { useFocusOnNavigation } from "../../../lib/focus";
import { normalizePath, usePath } from "../../../lib/router";
import { mockApi, renderWithProviders, type Routes } from "../../../test-utils";
import { AdminRoutes, canonicalAdminPath } from "../AdminRoutes";

export const ME: User = { id: "ada", name: "Ada", email: "ada@example.invalid", role: "admin" };

export const person = (fields: Partial<AdminUser> & { id: string; name: string }): AdminUser => ({
  email: `${fields.id}@example.invalid`,
  origin: "local",
  role: "user",
  roleSource: "local",
  roleOverride: null,
  disabled: false,
  mustChangePassword: false,
  groups: [],
  lastSignInAt: null,
  ...fields,
});

export const group = (fields: Partial<AdminGroup> & { id: string; name: string }): AdminGroup => ({
  source: "local",
  memberIds: [],
  categories: 0,
  links: 0,
  seenAt: null,
  ...fields,
});

export const usersAnswer = (...users: AdminUser[]) => ({ status: 200, body: { users } });
export const groupsAnswer = (...groups: AdminGroup[]) => ({ status: 200, body: { groups } });
export const apiError = (status: number, code: string, fields?: Record<string, string>) => ({ status, body: { error: { code, message: "", fields } } });

/** The administration pages as the app routes them: canonical path, focus on the page after each navigation. */
function AdminHarness({ me }: { me: User }) {
  const path = usePath();
  useFocusOnNavigation();
  return (
    <main id="content" tabIndex={-1}>
      <AdminRoutes path={canonicalAdminPath(normalizePath(path))} user={me} />
    </main>
  );
}

/** Mock the API, open `path` (query included) and render the administration pages there. */
export function renderAdmin(path: string, routes: Routes, me: User = ME) {
  history.replaceState(null, "", path);
  const fetchMock = mockApi(routes);
  renderWithProviders(<AdminHarness me={me} />);
  return { fetchMock, user: userEvent.setup() };
}

/** Return the h1 of the page. */
export const pageHeading = () => screen.getByRole("heading", { level: 1 });
