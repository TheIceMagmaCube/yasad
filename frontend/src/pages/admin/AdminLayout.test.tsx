import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { User } from "../../api";
import { mockApi, renderWithProviders } from "../../test-utils";
import { ADMIN_HOME, ADMIN_TABS, adminTab, AdminLayout, type AdminTab } from "./AdminLayout";
import { AdminRoutes } from "./AdminRoutes";

const ADA: User = { id: "ada", name: "Ada Lovelace", email: "ada@example.invalid", role: "admin" };
const BOB: User = { id: "bob", name: "Bob", email: "bob@example.invalid", role: "user" };
const LABELS: Record<AdminTab, string> = { users: "Users", groups: "Groups", catalog: "Catalog" };
// Each section keeps its own category colour, so the tabs stay told apart at a glance.
const FILLS: Record<AdminTab, string> = { users: "category-3", groups: "category-4", catalog: "category-2" };

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function adminNav() {
  return screen.getByRole("navigation", { name: "Administration" });
}

describe("adminTab", () => {
  it("opens the bare path on the first section and maps each section to its own address", () => {
    expect(ADMIN_HOME).toBe("/admin/users");
    expect(adminTab("/admin")).toBe("users");
    expect(adminTab("/admin/")).toBe("users");
    for (const tab of ADMIN_TABS) expect(adminTab(`/admin/${tab}`)).toBe(tab);
  });

  it("knows no other address", () => {
    expect(adminTab("/admin/nowhere")).toBeNull();
    expect(adminTab("/admin/users/ada")).toBeNull();
    expect(adminTab("/administration")).toBeNull();
  });
});

describe("AdminLayout", () => {
  it.each(ADMIN_TABS)("lists every section in one navigation and marks %s as the current one", async (tab) => {
    renderWithProviders(
      <AdminLayout tab={tab}>
        <h1>Page</h1>
      </AdminLayout>,
    );
    const links = within(adminNav()).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(ADMIN_TABS.map((t) => LABELS[t]));
    expect(links.map((link) => link.getAttribute("href"))).toEqual(ADMIN_TABS.map((t) => `/admin/${t}`));
    expect(within(adminNav()).getByRole("link", { current: "page" })).toHaveTextContent(LABELS[tab]);
    expect(within(adminNav()).getAllByRole("link", { current: false })).toHaveLength(ADMIN_TABS.length - 1);
    expect(within(adminNav()).getByRole("link", { current: "page" }).className.split(" ")).toContain(
      `aria-[current=page]:bg-${FILLS[tab]}-fill`,
    );
    await waitFor(() => expect(document.title).toBe(`${LABELS[tab]} - Administration - YASAD`));
  });

  it("marks the current section by an underline as well as its colour, and keeps a visible focus", () => {
    renderWithProviders(
      <AdminLayout tab="groups">
        <h1>Page</h1>
      </AdminLayout>,
    );
    for (const link of within(adminNav()).getAllByRole("link")) {
      expect(link.className.split(" ")).toEqual(
        expect.arrayContaining(["aria-[current=page]:underline", "focus-visible:outline-2", "min-h-11"]),
      );
      expect(link.className).not.toMatch(/(^|\s)outline-none(\s|$)/);
    }
  });

  it("names the sections in French", async () => {
    localStorage.setItem("yasad.language", "fr");
    renderWithProviders(
      <AdminLayout tab="users">
        <h1>Page</h1>
      </AdminLayout>,
    );
    const links = within(adminNav()).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Utilisateurs", "Groupes", "Catalogue"]);
    await waitFor(() => expect(document.title).toBe("Utilisateurs - Administration - YASAD"));
  });
});

describe("AdminRoutes", () => {
  const EMPTY = {
    "GET /api/admin/users": { status: 200, body: { users: [] } },
    "GET /api/admin/groups": { status: 200, body: { groups: [] } },
    "GET /api/admin/catalog/state": { status: 200, body: { managedByFile: false, categories: 0, links: 0, groups: 0 } },
  };

  it.each(ADMIN_TABS)("shows the %s section inside the navigation to an admin", async (tab) => {
    mockApi(EMPTY);
    renderWithProviders(<AdminRoutes path={`/admin/${tab}`} user={ADA} />);
    expect(await screen.findByRole("heading", { level: 1, name: LABELS[tab] })).toBeInTheDocument();
    expect(within(adminNav()).getByRole("link", { current: "page" })).toHaveTextContent(LABELS[tab]);
  });

  it("gives a non-admin the admins only view, without the navigation", () => {
    const fetchMock = mockApi({});
    renderWithProviders(<AdminRoutes path="/admin/users" user={BOB} />);
    expect(screen.getByRole("heading", { level: 1, name: "Admins only" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Administration" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows an unknown section as not found, without the navigation", () => {
    mockApi({});
    renderWithProviders(<AdminRoutes path="/admin/nowhere" user={ADA} />);
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Administration" })).toBeNull();
  });
});
