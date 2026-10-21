import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminCategory, CatalogState } from "../../../api";
import { getAnnouncer } from "../../../test-utils";
import { apiError, group, groupsAnswer, person, renderAdmin, usersAnswer } from "./testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADA = person({ id: "ada", name: "Ada", role: "admin" });
const BOB = person({ id: "bob", name: "Bob" });
const CAROL = person({ id: "carol", name: "Carol", origin: "oidc", disabled: true });
const FINANCE = group({ id: "g1", name: "Finance", memberIds: ["bob"], categories: 1, links: 1 });
const DEVELOPERS = group({ id: "o1", name: "developers", source: "oidc", memberIds: ["carol"], seenAt: "2026-10-01T00:00:00.000Z" });
const TYPED = group({ id: "o2", name: "auditors", source: "oidc", seenAt: null });
const EVERYONE = group({ id: "system:everyone", name: "everyone", source: "system" });
const STATE: CatalogState = { managedByFile: false, categories: 1, links: 2, groups: 2 };
const link = (id: string, title: string, groups: string[]) => ({
  id,
  categoryId: "tools",
  title,
  description: "",
  url: `https://${id}.example.invalid`,
  icon: null,
  iconKnown: false,
  keywords: [],
  active: true,
  check: false,
  status: null,
  groups,
  revision: 1,
});
const CATALOG: AdminCategory[] = [
  { id: "tools", title: "Tools", groups: ["local:Finance", "@everyone"], revision: 1, links: [link("books", "Books", ["local:Finance"]), link("wiki", "Wiki", ["@everyone"])] },
];

const routes = (extra = {}, state = STATE) => ({
  "GET /api/admin/users": usersAnswer(ADA, BOB, CAROL),
  "GET /api/admin/groups": groupsAnswer(EVERYONE, FINANCE, DEVELOPERS, TYPED),
  "GET /api/admin/categories": { status: 200, body: { categories: CATALOG } },
  "GET /api/admin/catalog/state": { status: 200, body: state },
  ...extra,
});

const section = (name: string) => screen.getByRole("region", { name });

describe("GroupPage", () => {
  it("lists everyone as a check box, members checked, and adds or removes one at once, announced", async () => {
    const { user } = renderAdmin(
      "/admin/groups/g1",
      routes({ "PUT /api/admin/groups/g1/members/ada": { status: 204 }, "DELETE /api/admin/groups/g1/members/bob": { status: 204 } }),
    );
    await screen.findByRole("heading", { level: 1, name: "Finance" });
    await waitFor(() => expect(document.title).toBe("Finance - People - Administration - YASAD"));
    const members = within(section("Members")).getByRole("group", { name: "Members" });
    expect(within(members).getByRole("checkbox", { name: "Bob" })).toBeChecked();
    expect(within(members).getByRole("checkbox", { name: "Ada" })).not.toBeChecked();
    expect(within(members).getByRole("checkbox", { name: "Ada" })).toHaveAccessibleDescription("ada@example.invalid");

    await user.click(within(members).getByRole("checkbox", { name: "Ada" }));
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Ada added to Finance."));
    expect(within(members).getByRole("checkbox", { name: "Ada" })).toBeChecked();
    await user.click(within(members).getByRole("checkbox", { name: "Bob" }));
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Bob removed from Finance."));
    expect(within(members).getByRole("checkbox", { name: "Bob" })).not.toBeChecked();
  });

  it("keeps two member changes whose answers come back in any order", async () => {
    const { fetchMock, user } = renderAdmin(
      "/admin/groups/g1",
      routes({ "PUT /api/admin/groups/g1/members/ada": { status: 204 }, "PUT /api/admin/groups/g1/members/carol": { status: 204 } }),
    );
    await screen.findByRole("heading", { level: 1, name: "Finance" });
    // Hold each addition until released, so both start before either ends.
    const answer = fetchMock.getMockImplementation()!;
    const held: (() => void)[] = [];
    fetchMock.mockImplementation((path, init) =>
      init?.method === "PUT" ? new Promise<Response>((resolve) => held.push(() => resolve(answer(path, init)))) : answer(path, init),
    );
    await user.click(screen.getByRole("checkbox", { name: "Ada" }));
    await user.click(screen.getByRole("checkbox", { name: "Carol" }));
    await waitFor(() => expect(held).toHaveLength(2));
    // The boxes follow the clicks before any answer.
    expect(screen.getByRole("checkbox", { name: "Ada" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Carol" })).toBeChecked();
    held[0]!();
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Ada added to Finance."));
    held[1]!();
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Carol added to Finance."));
    expect(screen.getByRole("checkbox", { name: "Ada" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Carol" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Bob" })).toBeChecked();
  });

  it("shows a member change the server refused, the check box left as it was", async () => {
    const { user } = renderAdmin("/admin/groups/g1", routes({ "PUT /api/admin/groups/g1/members/ada": apiError(409, "read_only_group") }));
    await screen.findByRole("heading", { level: 1, name: "Finance" });
    await user.click(screen.getByRole("checkbox", { name: "Ada" }));
    expect(await screen.findByRole("group", { name: /cannot be changed here/ })).toHaveFocus();
    expect(screen.getByRole("checkbox", { name: "Ada" })).not.toBeChecked();
  });

  it("says what the group opens, from the catalog as stored, each item a link to its page", async () => {
    renderAdmin("/admin/groups/g1", routes());
    await screen.findByRole("heading", { level: 1, name: "Finance" });
    const opens = section("What this group opens");
    await waitFor(() => expect(within(opens).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Tools", "BooksTools"]));
    expect(within(opens).getByText("Categories")).toBeInTheDocument();
    expect(within(opens).getByText("Links")).toBeInTheDocument();
    expect(within(opens).getByRole("link", { name: "Tools" })).toHaveAttribute("href", "/admin/links/categories/tools");
    expect(within(opens).getByRole("link", { name: "Books" })).toHaveAttribute("href", "/admin/links/books");
  });

  it("shows the members of a provider group read-only, a disabled account said in words", async () => {
    renderAdmin("/admin/groups/o1", routes());
    await screen.findByRole("heading", { level: 1, name: "developers" });
    expect(screen.getByText("Identity provider group")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
    const members = section("Members");
    expect(within(members).getByRole("link", { name: "Carol" })).toHaveAttribute("href", "/admin/users/carol");
    expect(within(members).getByText("Disabled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
    expect(screen.queryByText(/Never received from the identity provider/)).toBeNull();
  });

  it("marks a provider group that was typed but never received in a sign-in", async () => {
    renderAdmin("/admin/groups/o2", routes());
    await screen.findByRole("heading", { level: 1, name: "auditors" });
    expect(screen.getByText("Never received from the identity provider. Created by hand.")).toBeInTheDocument();
  });

  it("describes a built-in group, with no member list and no action", async () => {
    renderAdmin("/admin/groups/system%3Aeveryone", routes());
    await screen.findByRole("heading", { level: 1, name: "@everyone" });
    expect(screen.getByText("Everyone, visitors included.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });

  it("renames in place, the focus back on Rename, and puts name_taken on the field", async () => {
    const { user } = renderAdmin(
      "/admin/groups/g1",
      routes({
        "PATCH /api/admin/groups/g1": [apiError(422, "invalid_input", { name: "name_taken" }), { status: 200, body: { group: { ...FINANCE, name: "Accounting" } } }],
      }),
    );
    await screen.findByRole("heading", { level: 1, name: "Finance" });
    await user.click(screen.getByRole("button", { name: "Rename" }));
    const field = screen.getByLabelText("Name");
    expect(field).toHaveFocus();
    await user.clear(field);
    await user.type(field, "Staff");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true"));

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Accounting");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Accounting" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Rename" })).toHaveFocus());
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Group renamed to Accounting."));
  });

  it("warns how much of the catalog a deleted group opened, then goes back to the list saying so", async () => {
    const { user } = renderAdmin("/admin/groups/g1", routes({ "DELETE /api/admin/groups/g1": { status: 204 } }));
    await screen.findByRole("heading", { level: 1, name: "Finance" });
    await user.click(screen.getByRole("button", { name: "Delete Finance" }));
    const confirm = screen.getByRole("group", { name: "Delete the group Finance?" });
    expect(confirm).toHaveFocus();
    expect(confirm).toHaveTextContent("The catalog uses it on 1 category and 1 link: they lose this group.");
    await user.click(within(confirm).getByRole("button", { name: "Delete for good" }));
    await waitFor(() => expect(location.pathname).toBe("/admin/users"));
    await waitFor(() => expect(document.querySelector('[data-slot="toolbar-status"]')).toHaveTextContent("Group Finance deleted."));
    await waitFor(() => expect(screen.getByLabelText("Filter by name or e-mail")).toHaveFocus());
  });

  it("goes back to the list it was opened from after a deletion, the text filter kept and the group filter dropped", async () => {
    const { user } = renderAdmin("/admin/users?q=bo&group=g1", routes({ "DELETE /api/admin/groups/g1": { status: 204 } }));
    await user.click(await screen.findByRole("link", { name: "Manage the group" }));
    await screen.findByRole("heading", { level: 1, name: "Finance" });
    await user.click(screen.getByRole("button", { name: "Delete Finance" }));
    await user.click(screen.getByRole("button", { name: "Delete for good" }));
    await waitFor(() => expect(location.pathname).toBe("/admin/users"));
    expect(location.search).toBe("?q=bo");
    expect(screen.getByLabelText("Filter by name or e-mail")).toHaveValue("bo");
  });

  it("locks Rename and Delete of a group the catalog file uses, saying why, members still editable", async () => {
    const { user } = renderAdmin("/admin/groups/g1", routes({}, { ...STATE, managedByFile: true }));
    await screen.findByRole("heading", { level: 1, name: "Finance" });
    const rename = await screen.findByRole("button", { name: "Rename" });
    await waitFor(() => expect(rename).toHaveAttribute("aria-disabled", "true"));
    expect(rename).toHaveAccessibleDescription("Used by the catalog file: cannot be renamed or deleted here.");
    expect(screen.getByRole("button", { name: "Delete Finance" })).toHaveAttribute("aria-disabled", "true");
    await user.click(rename);
    expect(screen.queryByLabelText("Name")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Delete Finance" }));
    expect(screen.queryByRole("group", { name: "Delete the group Finance?" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Ada" })).toBeEnabled();
  });
});
