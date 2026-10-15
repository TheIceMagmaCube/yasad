import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminGroup, AdminUser } from "../../api";
import { mockApi, renderWithProviders, sentBody } from "../../test-utils";
import { AdminGroups } from "./AdminGroups";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const person = (id: string, name: string): AdminUser => ({
  id,
  name,
  email: `${id}@example.invalid`,
  origin: "local",
  role: "user",
  roleSource: "local",
  roleOverride: null,
  disabled: false,
  mustChangePassword: false,
  groups: [],
  lastSignInAt: null,
});

const EVERYONE: AdminGroup = { id: "system:everyone", name: "everyone", source: "system", memberIds: [], categories: 1, links: 3 };
const CONTRACTORS: AdminGroup = { id: "g1", name: "Contractors", source: "local", memberIds: ["bob"], categories: 1, links: 2 };
const DEVELOPERS: AdminGroup = { id: "o1", name: "Developers", source: "oidc", memberIds: [], categories: 0, links: 1 };
const USERS = { status: 200, body: { users: [person("ada", "Ada"), person("bob", "Bob")] } };

const card = (name: string) => screen.getByRole("heading", { name: new RegExp(`^${name}`) }).closest("li")!;

describe("AdminGroups", () => {
  it("shows members and catalog use, and offers no change on OIDC and built-in groups", async () => {
    mockApi({ "GET /api/admin/groups": { status: 200, body: { groups: [EVERYONE, CONTRACTORS, DEVELOPERS] } }, "GET /api/admin/users": USERS });
    renderWithProviders(<AdminGroups />);
    expect(await screen.findByRole("heading", { name: /^Contractors/ })).toBeInTheDocument();
    expect(card("Contractors")).toHaveTextContent("1 member · Opens 1 category and 2 links.");
    expect(within(card("Contractors")).getByRole("button", { name: "Remove Bob" })).toBeInTheDocument();
    for (const name of ["everyone", "Developers"]) {
      expect(card(name)).toHaveTextContent("Managed outside YASAD.");
      expect(within(card(name)).queryByRole("button")).toBeNull();
    }
  });

  it("adds a member chosen among those not in the group", async () => {
    const fetchMock = mockApi({
      "GET /api/admin/groups": { status: 200, body: { groups: [CONTRACTORS] } },
      "GET /api/admin/users": USERS,
      "PUT /api/admin/groups/g1/members/ada": { status: 204 },
    });
    renderWithProviders(<AdminGroups />);
    const user = userEvent.setup();
    const select = await screen.findByLabelText("Person to add to Contractors");
    expect(within(select).queryByRole("option", { name: /Bob/ })).toBeNull();
    await user.selectOptions(select, "Ada (ada@example.invalid)");
    await user.click(screen.getByRole("button", { name: "Add a member to Contractors" }));
    expect(fetchMock.mock.calls.map((c) => `${c[1]?.method ?? "GET"} ${c[0]}`)).toContain("PUT /api/admin/groups/g1/members/ada");
  });

  it("creates a group and shows a taken name under the field", async () => {
    const fetchMock = mockApi({
      "GET /api/admin/groups": { status: 200, body: { groups: [CONTRACTORS] } },
      "GET /api/admin/users": USERS,
      "POST /api/admin/groups": { status: 422, body: { error: { code: "invalid_input", message: "", fields: { name: "name_taken" } } } },
    });
    renderWithProviders(<AdminGroups />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "New group" }));
    await user.type(screen.getByLabelText("Name"), "Contractors");
    await user.click(screen.getByRole("button", { name: "Create the group" }));
    expect(await screen.findByText("A local group already has this name, perhaps with other capitals.")).toBeInTheDocument();
    expect(sentBody(fetchMock, 2)).toEqual({ name: "Contractors" });
  });

  it("warns how much of the catalog a deleted group opened", async () => {
    mockApi({
      "GET /api/admin/groups": [{ status: 200, body: { groups: [CONTRACTORS] } }, { status: 200, body: { groups: [] } }],
      "GET /api/admin/users": USERS,
      "DELETE /api/admin/groups/g1": { status: 204 },
    });
    renderWithProviders(<AdminGroups />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Delete Contractors" }));
    expect(screen.getByText("The catalog uses it on 1 category and 2 links: they lose this group.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete for good" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Group Contractors deleted.");
  });
});
