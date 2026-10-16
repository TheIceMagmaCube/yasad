import { cleanup, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminGroup, AdminUser, CatalogState } from "../../api";
import { primeHome, useHomeEntry } from "../../lib/home-store";
import { getAnnouncer, mockApi, renderWithProviders, type Routes, sentBody } from "../../test-utils";
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
const SIGNED_IN: AdminGroup = { id: "system:authenticated", name: "authenticated", source: "system", memberIds: [], categories: 0, links: 0 };
const CONTRACTORS: AdminGroup = { id: "g1", name: "Contractors", source: "local", memberIds: ["bob", "carol", "dan"], categories: 1, links: 2 };
const STAFF: AdminGroup = { id: "g2", name: "Staff", source: "local", memberIds: [], categories: 0, links: 0 };
const DEVELOPERS: AdminGroup = { id: "o1", name: "Developers", source: "oidc", memberIds: ["ada"], categories: 0, links: 1 };
const PEOPLE = [person("ada", "Ada"), person("bob", "Bob"), person("carol", "Carol"), person("dan", "Dan")];
const STATE: CatalogState = { managedByFile: false, categories: 2, links: 5, groups: 3 };

const groups = (...list: AdminGroup[]) => ({ status: 200, body: { groups: list } });
const users = (list = PEOPLE) => ({ status: 200, body: { users: list } });
const routes = (extra: Routes = {}, state = STATE): Routes => ({
  "GET /api/admin/groups": groups(EVERYONE, SIGNED_IN, CONTRACTORS, STAFF, DEVELOPERS),
  "GET /api/admin/users": users(),
  "GET /api/admin/catalog/state": { status: 200, body: state },
  ...extra,
});

/** Store home data and return a hook reading it, to check a change drops it. */
function cachedHome() {
  primeHome("user:ada", { signedIn: true, categories: [], empty: null });
  return renderHook(() => useHomeEntry("user:ada")).result;
}

const row = (title: string | RegExp) => screen.getByText(title, { selector: "p[id$='-title']" }).closest("li")!;

async function renderPage(r: Routes = routes()) {
  const fetchMock = mockApi(r);
  renderWithProviders(<AdminGroups />);
  await screen.findByText("Contractors", { selector: "p[id$='-title']" });
  return { fetchMock, userEv: userEvent.setup() };
}

describe("AdminGroups", () => {
  it("lists the groups in sections by origin, with members and how the catalog uses them", async () => {
    await renderPage();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Built-in", "Local", "Identity provider"]);
    const everyone = row(/^Everyone/);
    expect(everyone).toHaveTextContent("Everyone @everyone");
    expect(everyone).toHaveTextContent("Everyone, visitors included.");
    expect(everyone).toHaveTextContent("Set on 1 category and 3 links");
    expect(everyone).not.toHaveTextContent("member");
    expect(within(everyone).queryByRole("button")).toBeNull();
    expect(row(/^Signed-in people/)).toHaveTextContent("Not in the catalog");

    expect(row("Contractors")).toHaveTextContent("3 members");
    expect(within(row("Contractors")).getByRole("button", { name: "Members (3) of Contractors" })).toBeInTheDocument();
    const developers = row("Developers");
    expect(developers).toHaveTextContent("Synced from the identity provider at each sign-in.");
    expect(developers).toHaveTextContent("Only on links: its members see them only if they also hold a group on the link's category.");
    expect(within(developers).getAllByRole("button").map((b) => b.textContent)).toEqual(["Members (1)"]);
    expect(screen.getByText("5 groups")).toBeInTheDocument();
  });

  it("names the built-in groups in French, their reference kept", async () => {
    localStorage.setItem("yasad.language", "fr");
    mockApi(routes());
    renderWithProviders(<AdminGroups />);
    const everyone = (await screen.findByText(/^Tout le monde/, { selector: "p[id$='-title']" })).closest("li")!;
    expect(everyone).toHaveTextContent("Tout le monde @everyone");
    expect(everyone).toHaveTextContent("Posé sur 1 catégorie et 3 liens");
    expect(screen.getByText(/^Personnes connectées/, { selector: "p" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Intégrés" })).toBeInTheDocument();
  });

  it("hides a section the filter leaves empty", async () => {
    const { userEv } = await renderPage();
    await userEv.type(screen.getByLabelText("Filter groups"), "contr");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Local"]);
    expect(screen.getByText("1 of 5 groups")).toBeInTheDocument();
  });

  it("shows the members of an OIDC group read-only", async () => {
    const { userEv } = await renderPage();
    await userEv.click(screen.getByRole("button", { name: "Members (1) of Developers" }));
    const panel = row("Developers");
    expect(within(panel).getByRole("list", { name: "Members of Developers" })).toHaveTextContent("Ada");
    expect(panel).toHaveTextContent("Membership comes from the identity provider: change it there.");
    expect(within(panel).queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(within(panel).queryByLabelText("Add people")).toBeNull();
  });

  it("lists at most eight people to add, and says how many match", async () => {
    const many = Array.from({ length: 300 }, (_, i) => person(`p${String(i).padStart(3, "0")}`, `Person ${String(i).padStart(3, "0")}`));
    const { userEv } = await renderPage(routes({ "GET /api/admin/users": users(many) }));
    await userEv.click(screen.getByRole("button", { name: "Members (0) of Staff" }));
    const panel = row("Staff");
    expect(within(panel).getAllByRole("button", { name: /^Add Person/ })).toHaveLength(8);
    expect(panel).toHaveTextContent("300 people match, 8 shown. Narrow the search.");
    await userEv.type(within(panel).getByLabelText("Add people"), "person 29");
    expect(within(panel).getAllByRole("button", { name: /^Add Person/ })).toHaveLength(8);
    expect(panel).toHaveTextContent("13 people match, 8 shown. Narrow the search.");
    await userEv.type(within(panel).getByLabelText("Add people"), "9");
    expect(within(panel).getAllByRole("button", { name: /^Add Person/ })).toHaveLength(1);
    await userEv.type(within(panel).getByLabelText("Add people"), "x");
    expect(panel).toHaveTextContent("Nobody matches.");
  });

  it("adds a person, keeping the focus and the query in the search field, and drops the cached home", async () => {
    const { fetchMock, userEv } = await renderPage(
      routes({
        "GET /api/admin/groups": [groups(CONTRACTORS, STAFF), groups(CONTRACTORS, { ...STAFF, memberIds: ["bob"] })],
        "PUT /api/admin/groups/g2/members/bob": { status: 204 },
      }),
    );
    const cached = cachedHome();
    await userEv.click(screen.getByRole("button", { name: "Members (0) of Staff" }));
    const search = within(row("Staff")).getByLabelText("Add people");
    expect(search).toHaveFocus();
    await userEv.type(search, "bo");
    await userEv.click(within(row("Staff")).getByRole("button", { name: "Add Bob to Staff" }));
    await waitFor(() => expect(search).toHaveFocus());
    expect(search).toHaveValue("bo");
    expect(within(row("Staff")).getByRole("list", { name: "Members of Staff" })).toHaveTextContent("Bob");
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Bob added to Staff."));
    expect(fetchMock.mock.calls.map((c) => `${c[1]?.method ?? "GET"} ${c[0]}`)).toContain("PUT /api/admin/groups/g2/members/bob");
    expect(cached.current).toBeNull();
  });

  it("removes a member in one click, the focus going to the next Remove, then the previous, then the search", async () => {
    const without = (...gone: string[]) => groups(EVERYONE, { ...CONTRACTORS, memberIds: CONTRACTORS.memberIds.filter((id) => !gone.includes(id)) });
    const { userEv } = await renderPage(
      routes({
        "GET /api/admin/groups": [groups(EVERYONE, CONTRACTORS), without("carol"), without("carol", "dan"), without("carol", "dan", "bob")],
        "DELETE /api/admin/groups/g1/members/carol": { status: 204 },
        "DELETE /api/admin/groups/g1/members/dan": { status: 204 },
        "DELETE /api/admin/groups/g1/members/bob": { status: 204 },
      }),
    );
    const cached = cachedHome();
    await userEv.click(screen.getByRole("button", { name: "Members (3) of Contractors" }));
    const panel = () => row("Contractors");
    await userEv.click(within(panel()).getByRole("button", { name: "Remove Carol from Contractors" }));
    await waitFor(() => expect(within(panel()).getByRole("button", { name: "Remove Dan from Contractors" })).toHaveFocus());
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Carol removed from Contractors."));
    expect(cached.current).toBeNull();

    await userEv.click(within(panel()).getByRole("button", { name: "Remove Dan from Contractors" }));
    await waitFor(() => expect(within(panel()).getByRole("button", { name: "Remove Bob from Contractors" })).toHaveFocus());
    await userEv.click(within(panel()).getByRole("button", { name: "Remove Bob from Contractors" }));
    await waitFor(() => expect(within(panel()).getByLabelText("Add people")).toHaveFocus());
    expect(panel()).toHaveTextContent("No members yet.");
  });

  it("clears a member error once the next change succeeds", async () => {
    const { userEv } = await renderPage(
      routes({
        "DELETE /api/admin/groups/g1/members/carol": { status: 500, body: { error: { code: "internal", message: "" } } },
        "DELETE /api/admin/groups/g1/members/dan": { status: 204 },
      }),
    );
    await userEv.click(screen.getByRole("button", { name: "Members (3) of Contractors" }));
    await userEv.click(within(row("Contractors")).getByRole("button", { name: "Remove Carol from Contractors" }));
    expect(await within(row("Contractors")).findByRole("group", { name: "Something went wrong. Try again." })).toHaveFocus();
    await userEv.click(within(row("Contractors")).getByRole("button", { name: "Remove Dan from Contractors" }));
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Dan removed from Contractors."));
    expect(within(row("Contractors")).queryByText("Something went wrong. Try again.")).toBeNull();
  });

  it("replaces a group deleted elsewhere by a focused message when a member change finds it gone", async () => {
    const { userEv } = await renderPage(
      routes({
        "GET /api/admin/groups": [groups(CONTRACTORS, STAFF), groups(CONTRACTORS)],
        "PUT /api/admin/groups/g2/members/bob": { status: 404, body: { error: { code: "not_found", message: "" } } },
      }),
    );
    await userEv.click(screen.getByRole("button", { name: "Members (0) of Staff" }));
    await userEv.click(within(row("Staff")).getByRole("button", { name: "Add Bob to Staff" }));
    expect(await screen.findByRole("group", { name: "This item no longer exists." })).toHaveFocus();
    expect(screen.queryByText("Staff", { selector: "p[id$='-title']" })).toBeNull();
  });

  it("shows the progress of an addition on its button", async () => {
    const { fetchMock, userEv } = await renderPage(routes());
    fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {}));
    await userEv.click(screen.getByRole("button", { name: "Members (0) of Staff" }));
    await userEv.click(within(row("Staff")).getByRole("button", { name: "Add Bob to Staff" }));
    const button = within(row("Staff")).getByRole("button", { name: "Add Bob to Staff" });
    expect(button).toHaveTextContent("Adding…");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveFocus();
  });

  it("renames in the row, the name selected, and focuses Rename after saving", async () => {
    const renamed = { ...STAFF, name: "Team" };
    const { userEv } = await renderPage(
      routes({ "GET /api/admin/groups": [groups(CONTRACTORS, STAFF), groups(CONTRACTORS, renamed)], "PATCH /api/admin/groups/g2": { status: 200, body: { group: renamed } } }),
    );
    await userEv.click(screen.getByRole("button", { name: "Rename Staff" }));
    const field = within(row("Staff")).getByLabelText("Name") as HTMLInputElement;
    expect(field).toHaveFocus();
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 5]);
    await userEv.keyboard("Team{Enter}");
    await waitFor(() => expect(screen.getByRole("button", { name: "Rename Team" })).toHaveFocus());
    expect(document.querySelector('[data-slot="toolbar-status"]')).toHaveTextContent("Group renamed to Team.");
  });

  it("puts name_taken on the field when renaming", async () => {
    const { userEv } = await renderPage(
      routes({ "PATCH /api/admin/groups/g2": { status: 422, body: { error: { code: "invalid_input", message: "", fields: { name: "name_taken" } } } } }),
    );
    await userEv.click(screen.getByRole("button", { name: "Rename Staff" }));
    await userEv.keyboard("contractors{Enter}");
    const field = within(row("Staff")).getByLabelText("Name");
    expect(await within(row("Staff")).findByRole("group", { name: "Check the highlighted fields." })).toHaveFocus();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(/already has this name/);
  });

  it("creates a group and focuses its Members button", async () => {
    const created: AdminGroup = { id: "g3", name: "Reviewers", source: "local", memberIds: [], categories: 0, links: 0 };
    const { fetchMock, userEv } = await renderPage(
      routes({ "GET /api/admin/groups": [groups(CONTRACTORS), groups(CONTRACTORS, created)], "POST /api/admin/groups": { status: 201, body: { group: created } } }),
    );
    await userEv.click(screen.getByRole("button", { name: "New group" }));
    await userEv.type(screen.getByLabelText("Name"), "Reviewers");
    await userEv.click(screen.getByRole("button", { name: "Create the group" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Members (0) of Reviewers" })).toHaveFocus());
    expect(sentBody(fetchMock, 3)).toEqual({ name: "Reviewers" });
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Group Reviewers created."));
  });

  it("warns how much of the catalog a deleted group opened, then leaves a focused message", async () => {
    const { userEv } = await renderPage(
      routes({
        "GET /api/admin/groups": [groups(EVERYONE, CONTRACTORS, STAFF), groups(EVERYONE, STAFF)],
        "DELETE /api/admin/groups/g1": { status: 204 },
      }),
    );
    const cached = cachedHome();
    await userEv.click(screen.getByRole("button", { name: "Delete Contractors" }));
    expect(row("Contractors")).toHaveTextContent("The catalog uses it on 1 category and 2 links: they lose this group.");
    await userEv.click(screen.getByRole("button", { name: "Delete for good" }));
    expect(await screen.findByRole("group", { name: "Group Contractors deleted." })).toHaveFocus();
    expect(cached.current).toBeNull();
  });

  it("locks Rename and Delete of a group the catalog file uses, saying why", async () => {
    const { userEv } = await renderPage(routes({}, { ...STATE, managedByFile: true }));
    const rename = screen.getByRole("button", { name: "Rename Contractors" });
    expect(rename).toHaveAttribute("aria-disabled", "true");
    expect(rename).toHaveAccessibleDescription("This group is used by the catalog file.");
    expect(screen.getByRole("button", { name: "Delete Contractors" })).toHaveAttribute("aria-disabled", "true");
    await userEv.click(rename);
    expect(within(row("Contractors")).queryByLabelText("Name")).toBeNull();
    // A group the file does not use stays editable, and members stay editable either way.
    expect(screen.getByRole("button", { name: "Rename Staff" })).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("button", { name: "Members (3) of Contractors" })).not.toHaveAttribute("aria-disabled");
  });
});
