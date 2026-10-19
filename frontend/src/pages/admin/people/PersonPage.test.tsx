import { cleanup, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { primeHome, useHomeEntry } from "../../../lib/home-store";
import { getAnnouncer, sentBody } from "../../../test-utils";
import { apiError, group, groupsAnswer, person, renderAdmin, usersAnswer } from "./testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADA = person({ id: "ada", name: "Ada", role: "admin" });
const BOB = person({ id: "bob", name: "Bob", groups: [{ id: "g1", name: "Finance", source: "local" }] });
const EVE = person({ id: "eve", name: "Eve", role: "admin" });
const CAROL = person({
  id: "carol",
  name: "Carol",
  origin: "oidc",
  role: "admin",
  roleSource: "override",
  roleOverride: "admin",
  groups: [{ id: "o1", name: "developers", source: "oidc" }],
});
const FINANCE = group({ id: "g1", name: "Finance", memberIds: ["bob"] });
const STAFF = group({ id: "g2", name: "Staff" });
const DEVELOPERS = group({ id: "o1", name: "developers", source: "oidc", memberIds: ["carol"], seenAt: "2026-10-01T00:00:00.000Z" });

const routes = (extra = {}) => ({
  "GET /api/admin/users": usersAnswer(ADA, BOB, CAROL, EVE),
  "GET /api/admin/groups": groupsAnswer(FINANCE, STAFF, DEVELOPERS),
  ...extra,
});

const section = (name: string) => screen.getByRole("region", { name });

describe("PersonPage", () => {
  it("shows a failed load of the groups on a person's page, with a retry, instead of loading for ever", async () => {
    const { user } = renderAdmin("/admin/users/bob", routes({ "GET /api/admin/groups": [apiError(500, "internal"), groupsAnswer(FINANCE, STAFF, DEVELOPERS)] }));
    expect(await screen.findByText("The users could not be loaded.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Bob" })).toBeInTheDocument();
  });

  it("adds and removes a local group with its check box at once, announced, the cached home dropped", async () => {
    const { fetchMock, user } = renderAdmin(
      "/admin/users/bob",
      routes({ "PUT /api/admin/groups/g2/members/bob": { status: 204 }, "DELETE /api/admin/groups/g1/members/bob": { status: 204 } }),
    );
    await screen.findByRole("heading", { level: 1, name: "Bob" });
    primeHome("user:ada", { signedIn: true, categories: [], empty: null });
    const cached = renderHook(() => useHomeEntry("user:ada")).result;
    const groups = section("Local groups");
    expect(within(groups).getByRole("checkbox", { name: "Finance" })).toBeChecked();
    expect(within(groups).getByRole("checkbox", { name: "Staff" })).not.toBeChecked();
    // Provider groups are no check box: the provider decides them.
    expect(within(groups).queryByRole("checkbox", { name: "developers" })).toBeNull();

    await user.click(within(groups).getByRole("checkbox", { name: "Staff" }));
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Bob added to Staff."));
    expect(within(groups).getByRole("checkbox", { name: "Staff" })).toBeChecked();
    expect(within(groups).getByRole("checkbox", { name: "Staff" })).toHaveFocus();
    expect(cached.current).toBeNull();

    await user.click(within(groups).getByRole("checkbox", { name: "Finance" }));
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Bob removed from Finance."));
    expect(within(groups).getByRole("checkbox", { name: "Finance" })).not.toBeChecked();
    expect(fetchMock.mock.calls.map(([path, init]) => `${init?.method ?? "GET"} ${path}`)).toContain("DELETE /api/admin/groups/g1/members/bob");
  });

  it("shows a membership that failed, the check box left as it was", async () => {
    const { user } = renderAdmin("/admin/users/bob", routes({ "PUT /api/admin/groups/g2/members/bob": apiError(500, "internal") }));
    await screen.findByRole("heading", { level: 1, name: "Bob" });
    await user.click(screen.getByRole("checkbox", { name: "Staff" }));
    expect(await screen.findByRole("group", { name: "The membership of Staff could not be changed." })).toHaveFocus();
    expect(screen.getByRole("checkbox", { name: "Staff" })).not.toBeChecked();
  });

  it("shows the provider's groups read-only, the e-mail managed there, and the role override select", async () => {
    renderAdmin("/admin/users/carol", routes());
    await screen.findByRole("heading", { level: 1, name: "Carol" });
    expect(within(section("From the identity provider")).getByRole("listitem")).toHaveTextContent("developers");
    const profile = screen.getByRole("form", { name: "Profile" });
    expect(within(profile).queryByLabelText("E-mail")).toBeNull();
    expect(within(profile).getByText("Managed by the identity provider.")).toBeInTheDocument();
    expect(within(profile).getByLabelText("Role")).toHaveValue("admin");
    // A provider account has no password here.
    expect(screen.queryByRole("button", { name: "Reset password" })).toBeNull();
  });

  it("saves only what changed, and puts last_local_admin at the top of the form", async () => {
    const { fetchMock, user } = renderAdmin("/admin/users/eve", routes({ "PATCH /api/admin/users/eve": apiError(409, "last_local_admin") }));
    await screen.findByRole("heading", { level: 1, name: "Eve" });
    await user.click(screen.getByRole("checkbox", { name: "Administrator" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("group", { name: /Keep at least one enabled local administrator/ })).toHaveFocus();
    const patch = fetchMock.mock.calls.findIndex(([path, init]) => path === "/api/admin/users/eve" && init?.method === "PATCH");
    expect(sentBody(fetchMock, patch)).toEqual({ role: "user" });
  });

  it("puts cannot_change_self at the top of the form", async () => {
    const { user } = renderAdmin("/admin/users/bob", routes({ "PATCH /api/admin/users/bob": apiError(403, "cannot_change_self") }));
    await screen.findByRole("heading", { level: 1, name: "Bob" });
    await user.click(screen.getByRole("checkbox", { name: "Disabled" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("group", { name: /You cannot change your own role/ })).toHaveFocus();
  });

  it("announces a saved profile without moving the focus", async () => {
    const { user } = renderAdmin("/admin/users/bob", routes({ "PATCH /api/admin/users/bob": { status: 200, body: { user: { ...BOB, name: "Robert" } } } }));
    await screen.findByRole("heading", { level: 1, name: "Bob" });
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Robert");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Robert" })).toBeInTheDocument();
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Robert updated."));
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
  });

  it("offers neither role, disabling, reset nor deletion on one's own page", async () => {
    renderAdmin("/admin/users/ada", routes());
    await screen.findByRole("heading", { level: 1, name: "Ada" });
    expect(screen.getByText("You cannot change your own role or disable your own account.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Administrator" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Disabled" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset password" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete Ada" })).toBeNull();
  });

  it("resets a password after confirmation, shows it once, and gives the focus back once noted", async () => {
    const { user } = renderAdmin("/admin/users/bob", routes({ "POST /api/admin/users/bob/password": { status: 200, body: { temporaryPassword: "first-temporary-pass" } } }));
    await screen.findByRole("heading", { level: 1, name: "Bob" });
    await user.click(screen.getByRole("button", { name: "Reset password" }));
    const confirm = screen.getByRole("group", { name: "Reset the password of Bob?" });
    expect(confirm).toHaveFocus();
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reset password" })).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Reset password" }));
    await user.click(screen.getByRole("button", { name: "Reset" }));
    const secret = await screen.findByRole("region", { name: "Temporary password for Bob" });
    expect(secret).toHaveFocus();
    expect(within(secret).getByLabelText("Temporary password")).toHaveValue("first-temporary-pass");
    await user.click(within(secret).getByRole("button", { name: "I have noted it" }));
    expect(screen.queryByRole("region", { name: "Temporary password for Bob" })).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Reset password" })).toHaveFocus());
  });

  it("keeps a password not noted yet when the admin goes back to the list, and recalls it there", async () => {
    const { user } = renderAdmin("/admin/users/bob", routes({ "POST /api/admin/users/bob/password": { status: 200, body: { temporaryPassword: "first-temporary-pass" } } }));
    await screen.findByRole("heading", { level: 1, name: "Bob" });
    await user.click(screen.getByRole("button", { name: "Reset password" }));
    await user.click(screen.getByRole("button", { name: "Reset" }));
    await screen.findByRole("region", { name: "Temporary password for Bob" });
    await user.click(screen.getByRole("link", { name: "Back to People" }));
    expect(await screen.findByText("Temporary password of Bob not noted.")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Show it" }));
    expect(await screen.findByRole("region", { name: "Temporary password for Bob" })).toBeInTheDocument();
  });

  it("deletes after confirmation, back on the list with a focused message in place of the row", async () => {
    const { user } = renderAdmin(
      "/admin/users/bob",
      routes({
        "DELETE /api/admin/users/bob": { status: 204 },
        "GET /api/admin/users": [usersAnswer(ADA, BOB, CAROL, EVE), usersAnswer(ADA, CAROL, EVE)],
      }),
    );
    await screen.findByRole("heading", { level: 1, name: "Bob" });
    await user.click(screen.getByRole("button", { name: "Delete Bob" }));
    const confirm = screen.getByRole("group", { name: "Delete Bob?" });
    expect(confirm).toHaveTextContent("Their sessions and group memberships are deleted too.");
    await user.click(within(confirm).getByRole("button", { name: "Delete for good" }));
    expect(await screen.findByRole("group", { name: "Bob deleted." })).toHaveFocus();
    expect(location.pathname).toBe("/admin/users");
    expect(screen.queryByRole("link", { name: "Bob" })).toBeNull();
  });

  it("warns that a provider account comes back at its next sign-in", async () => {
    const { user } = renderAdmin("/admin/users/carol", routes());
    await screen.findByRole("heading", { level: 1, name: "Carol" });
    await user.click(screen.getByRole("button", { name: "Delete Carol" }));
    expect(screen.getByRole("group", { name: "Delete Carol?" })).toHaveTextContent(/created again at its next sign-in/);
  });
});
