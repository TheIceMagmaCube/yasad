import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { group, groupsAnswer, pageHeading, person, renderAdmin, usersAnswer } from "./testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADA = person({ id: "ada", name: "Ada", role: "admin", lastSignInAt: "2026-10-15T09:00:00.000Z" });
const BOB = person({ id: "bob", name: "Bob", groups: [{ id: "g1", name: "Finance", source: "local" }] });
const HELENE = person({ id: "helene", name: "Hélène", disabled: true });
const DAN = person({ id: "dan", name: "Dan", mustChangePassword: true });
const FINANCE = group({ id: "g1", name: "Finance", memberIds: ["bob"], categories: 1, links: 2 });
const STAFF = group({ id: "o1", name: "staff", source: "oidc", seenAt: null });
const EVERYONE = group({ id: "system:everyone", name: "everyone", source: "system" });

const routes = () => ({
  "GET /api/admin/users": usersAnswer(ADA, BOB, HELENE, DAN),
  "GET /api/admin/groups": groupsAnswer(EVERYONE, FINANCE, STAFF),
});

const rowOf = (name: string) => screen.getByRole("link", { name }).closest("tr")!;

describe("PeoplePage", () => {
  it("lists people in a table with their groups and only the abnormal states marked in words", async () => {
    renderAdmin("/admin/users", routes());
    const table = await screen.findByRole("table", { name: "People" });
    expect(pageHeading()).toHaveTextContent("People");
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Name, sorted ascending", "E-mail", "Groups", "Last sign-in", "State"]);
    expect(within(rowOf("Ada")).getByText("(you)")).toBeInTheDocument();
    expect(within(rowOf("Bob")).getByText("Finance")).toBeInTheDocument();
    expect(within(rowOf("Hélène")).getAllByText("Disabled").length).toBeGreaterThan(0);
    expect(within(rowOf("Dan")).getAllByText("Temporary password").length).toBeGreaterThan(0);
    expect(within(rowOf("Bob")).queryByText("Disabled")).toBeNull();
    expect(rowOf("Ada").querySelector("time")).toHaveAttribute("datetime", "2026-10-15T09:00:00.000Z");
    expect(screen.getByText("4 people")).toBeInTheDocument();
  });

  it("filters by name or e-mail, ignoring accents, keeping the filter in the address", async () => {
    const { user } = renderAdmin("/admin/users", routes());
    await screen.findByRole("table");
    await user.type(screen.getByLabelText("Filter by name or e-mail"), "helene");
    expect(screen.getByText("1 of 4 people")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Bob" })).toBeNull();
    expect(location.search).toBe("?q=helene");

    await user.clear(screen.getByLabelText("Filter by name or e-mail"));
    await user.type(screen.getByLabelText("Filter by name or e-mail"), "nobody");
    await user.click(screen.getByRole("button", { name: "Clear the filter" }));
    await waitFor(() => expect(screen.getByLabelText("Filter by name or e-mail")).toHaveFocus());
    expect(screen.getByLabelText("Filter by name or e-mail")).toHaveValue("");
    expect(location.search).toBe("");
  });

  it("narrows the table to a group chosen in the select or given in the address, with a line about the group", async () => {
    const { user } = renderAdmin("/admin/users?group=g1", routes());
    await screen.findByRole("table");
    const select = screen.getByLabelText("Group");
    expect(select).toHaveValue("g1");
    expect(screen.getAllByRole("link", { name: /^(Ada|Bob|Hélène|Dan)$/ }).map((a) => a.textContent)).toEqual(["Bob"]);
    expect(screen.getByText("1 of 4 people")).toBeInTheDocument();
    expect(screen.getByText(/1 person · 1 category, 2 links/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage the group" })).toHaveAttribute("href", "/admin/groups/g1");
    // Built-in groups hold everyone and are no filter; a provider group never received says so.
    expect(within(select).queryByRole("option", { name: /everyone/ })).toBeNull();
    expect(within(select).getByRole("option", { name: "staff (0), typed, never received" })).toBeInTheDocument();

    await user.selectOptions(select, "o1");
    expect(location.search).toBe("?group=o1");
    expect(screen.getByText("No members.")).toBeInTheDocument();
    await user.selectOptions(select, "");
    expect(location.search).toBe("");
    expect(screen.getByText("4 people")).toBeInTheDocument();
  });

  it("narrows the table to a state given in the address, with a line that shows everyone again", async () => {
    const { user } = renderAdmin("/admin/users?state=temporary", routes());
    await screen.findByRole("table");
    expect(screen.getAllByRole("link", { name: /^(Ada|Bob|Hélène|Dan)$/ }).map((a) => a.textContent)).toEqual(["Dan"]);
    expect(screen.getByText("1 of 4 people")).toBeInTheDocument();
    expect(screen.getByText("Filter: Temporary password")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show all" }));
    expect(location.search).toBe("");
    expect(screen.getByText("4 people")).toBeInTheDocument();
    expect(screen.queryByText(/^Filter:/)).toBeNull();
    await waitFor(() => expect(screen.getByLabelText("Filter by name or e-mail")).toHaveFocus());
  });

  it("narrows to disabled accounts, ignores an unknown state, and says when nobody is left in one", async () => {
    renderAdmin("/admin/users?state=disabled", routes());
    await screen.findByRole("table");
    expect(screen.getAllByRole("link", { name: /^(Ada|Bob|Hélène|Dan)$/ }).map((a) => a.textContent)).toEqual(["Hélène"]);
    expect(screen.getByText("Filter: Disabled")).toBeInTheDocument();
    cleanup();

    renderAdmin("/admin/users?state=toString", routes());
    await screen.findByRole("table");
    expect(screen.getByText("4 people")).toBeInTheDocument();
    expect(screen.queryByText(/^Filter:/)).toBeNull();
    cleanup();

    renderAdmin("/admin/users?state=temporary", { ...routes(), "GET /api/admin/users": usersAnswer(ADA, BOB) });
    expect(await screen.findByText("Nothing to do.")).toBeInTheDocument();
  });

  it("opens a person's page from the row, then gives the focus back to that row by the back link, filter kept", async () => {
    const { user } = renderAdmin("/admin/users?q=bo", routes());
    await screen.findByRole("table");
    await user.click(screen.getByRole("link", { name: "Bob" }));
    expect(location.pathname).toBe("/admin/users/bob");
    expect(await screen.findByRole("heading", { level: 1, name: "Bob" })).toHaveFocus();
    await waitFor(() => expect(document.title).toBe("Bob - People - Administration - YASAD"));

    await user.click(screen.getByRole("link", { name: "Back to People" }));
    expect(location.pathname + location.search).toBe("/admin/users?q=bo");
    await waitFor(() => expect(screen.getByRole("link", { name: "Bob" })).toHaveFocus());
    expect(screen.getByLabelText("Filter by name or e-mail")).toHaveValue("bo");
  });

  it("gives the focus back to the row after the browser's Back too", async () => {
    const { user } = renderAdmin("/admin/users", routes());
    await screen.findByRole("table");
    await user.click(screen.getByRole("link", { name: "Dan" }));
    await screen.findByRole("heading", { level: 1, name: "Dan" });
    act(() => history.back());
    await waitFor(() => expect(screen.getByRole("link", { name: "Dan" })).toHaveFocus());
  });

  it("says when the address names a person who no longer exists", async () => {
    renderAdmin("/admin/users/zoe", routes());
    expect(await screen.findByRole("heading", { level: 1, name: "This item no longer exists." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to People" })).toHaveAttribute("href", "/admin/users");
  });

  it("shows a load failure with Retry under the page heading", async () => {
    const { user } = renderAdmin("/admin/users", {
      "GET /api/admin/users": [{ status: 500, body: {} }, usersAnswer(ADA)],
      "GET /api/admin/groups": groupsAnswer(),
    });
    expect(await screen.findByText("The users could not be loaded.")).toBeInTheDocument();
    expect(pageHeading()).toHaveTextContent("People");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Ada" })).toBeInTheDocument();
  });
});
