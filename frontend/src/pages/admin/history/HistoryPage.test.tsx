import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HistoryEntry } from "../../../api";
import { getStatus } from "../../../test-utils";
import { linksRoutes } from "../links/testing";
import { person, renderAdmin } from "../people/testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const AT = "2026-10-19T08:00:00.000Z";
const ADA = { id: "ada", name: "Ada", email: "ada@example.invalid", exists: true };

const LINK_FIELDS = { categoryId: "tools", url: "https://wiki.example.invalid", description: "", icon: null, keywords: ["docs"], active: true, position: 0, groups: ["@everyone"] };

const entry = (fields: Partial<HistoryEntry> & Pick<HistoryEntry, "id" | "action" | "object">): HistoryEntry => ({
  at: AT,
  actor: ADA,
  related: null,
  before: null,
  after: null,
  details: null,
  ...fields,
});

const RENAMED = entry({
  id: 9,
  action: "update",
  object: { type: "link", id: "wiki", label: "Team wiki", exists: true },
  before: { ...LINK_FIELDS, title: "Wiki" },
  after: { ...LINK_FIELDS, title: "Team wiki" },
});
const SET_UP = entry({
  id: 8,
  action: "create",
  actor: null,
  object: { type: "user", id: "zoe", label: "Zoé", exists: false },
  after: { name: "Zoé", email: "zoe@example.invalid", origin: "local", role: "admin", roleOverride: null, disabled: false, mustChangePassword: false, groups: [] },
  details: { source: "setup" },
});
const DROPPED = entry({
  id: 7,
  action: "delete",
  object: { type: "category", id: "tools", label: "Tools", exists: false },
  before: { title: "Tools", position: 1, groups: ["local:Finance", "@authenticated"], links: [{ id: "grafana", title: "Grafana" }] },
});
const IMPORTED = entry({
  id: 6,
  action: "import",
  object: { type: "catalog", id: null, label: null, exists: false },
  details: {
    added: { categories: ["dev"], links: ["git"] },
    updated: { categories: [], links: [] },
    removed: { categories: [], links: ["old"] },
    groupsCreated: ["local:ops"],
    labels: { categories: { dev: "Development" }, links: { git: { title: "Git", categoryId: "dev" }, old: { title: "Old intranet", categoryId: "dev" } } },
    truncated: true,
  },
});
const MOVED = entry({
  id: 5,
  action: "move",
  object: { type: "link", id: "mail", label: "Mail", exists: true },
  before: { ...LINK_FIELDS, title: "Mail", position: 0 },
  after: { ...LINK_FIELDS, title: "Mail", position: 1 },
});
const JOINED = entry({
  id: 4,
  action: "member_add",
  object: { type: "group", id: "g1", label: "Finance", exists: true },
  related: { type: "user", id: "bob", label: "Bob", exists: true },
});

const page = (entries: HistoryEntry[], next: number | null = null) => ({ status: 200, body: { entries, next } });
const ACTORS = { status: 200, body: { actors: [ADA, { id: "gone", name: "Gone", email: "gone@example.invalid", exists: false }] } };

const routes = (extra = {}) => ({
  "GET /api/admin/history/actors": ACTORS,
  "GET /api/admin/history": page([RENAMED, SET_UP, DROPPED, IMPORTED, MOVED, JOINED]),
  ...extra,
});

/** Return the row of the entry whose disclosure button names `label`, and that button. */
function rowOf(label: string | RegExp) {
  const button = screen.getByRole("button", { name: label });
  return { button, row: button.closest("tr")! };
}

/** Open the details of an entry and return them. */
async function open(user: ReturnType<typeof renderAdmin>["user"], label: string | RegExp) {
  const { button } = rowOf(label);
  await user.click(button);
  return document.getElementById(button.getAttribute("aria-controls")!)!;
}

const headers = (table: HTMLElement) => within(table).getAllByRole("columnheader").map((th) => th.textContent);
const rows = (table: HTMLElement) => within(table).getAllByRole("row").slice(1).map((tr) => [...tr.children].map((cell) => cell.textContent));

describe("HistoryPage", () => {
  it("lists the entries in a table, the item a link to its page while it exists, else named as deleted", async () => {
    renderAdmin("/admin/history", routes());
    const table = await screen.findByRole("table", { name: "Changes made by administrators, newest first" });
    expect(screen.getByRole("heading", { level: 1, name: "History" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Administration" })).getByRole("link", { name: "History" })).toHaveAttribute("aria-current", "page");
    expect(getStatus()).toHaveTextContent("6 entries");

    expect(within(table).getByRole("link", { name: "Team wiki" })).toHaveAttribute("href", "/admin/links/wiki");
    expect(within(table).getByRole("link", { name: "Finance" })).toHaveAttribute("href", "/admin/groups/g1");
    expect(within(table).queryByRole("link", { name: "Zoé" })).toBeNull();
    expect(rowOf(/Created, Zoé/).row).toHaveTextContent("Zoé(account deleted)");
    expect(rowOf(/Deleted, Tools/).row).toHaveTextContent("Tools(deleted)");
    expect(rowOf(/Created, Zoé/).row).toHaveTextContent("System");
    expect(within(rowOf(/Changed, Team wiki/).row).getByRole("link", { name: "Ada" })).toHaveAttribute("href", "/admin/users/ada");
    expect(within(rowOf(/Changed, Team wiki/).row).getAllByText((_, el) => el?.tagName === "TIME")[0]).toHaveAttribute("datetime", AT);
  });

  it("applies the filters on submit, in the address and in the request, local days turned into instants", async () => {
    const from = new Date(2026, 9, 1).toISOString();
    const to = new Date(2026, 9, 20).toISOString();
    const query = `?actor=none&type=link&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const { user, fetchMock } = renderAdmin("/admin/history", routes({ [`GET /api/admin/history${query}`]: page([RENAMED]) }));
    await screen.findByRole("table");

    await user.selectOptions(screen.getByLabelText("Person"), "System");
    await user.selectOptions(screen.getByLabelText("Type"), "Link");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-19" } });
    expect(fetchMock.mock.calls.filter(([path]) => String(path).startsWith("/api/admin/history?"))).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Filter" }));

    await waitFor(() => expect(getStatus()).toHaveTextContent("1 entry"));
    expect(fetchMock.mock.calls.map(([path]) => path)).toContain(`/api/admin/history${query}`);
    expect(location.pathname + location.search).toBe("/admin/history?actor=none&type=link&from=2026-10-01&to=2026-10-19");

    await user.click(screen.getByRole("button", { name: "Clear the filters" }));
    await waitFor(() => expect(getStatus()).toHaveTextContent("6 entries"));
    expect(location.search).toBe("");
    expect(screen.getByLabelText("Person")).toHaveValue("");
  });

  it("reads the filters of the address, the item one included, and can drop the item", async () => {
    const { user, fetchMock } = renderAdmin(
      "/admin/history?actor=gone&type=link&object=wiki",
      routes({ "GET /api/admin/history?actor=gone&type=link&object=wiki": page([RENAMED]), "GET /api/admin/history?actor=gone&type=link": page([RENAMED, MOVED]) }),
    );
    await waitFor(() => expect(getStatus()).toHaveTextContent("1 entry"));
    expect(fetchMock.mock.calls.map(([path]) => path)).toContain("/api/admin/history?actor=gone&type=link&object=wiki");
    expect(screen.getByLabelText("Type")).toHaveValue("link");
    await waitFor(() => expect(screen.getByLabelText("Person")).toHaveDisplayValue("Gone (account deleted)"));
    expect(screen.getByText("Item: Team wiki")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show all items" }));
    await waitFor(() => expect(getStatus()).toHaveTextContent("2 entries"));
    expect(location.search).toBe("?actor=gone&type=link");
  });

  it("refuses an end date before the start date, without a request", async () => {
    const { user, fetchMock } = renderAdmin("/admin/history", routes());
    await screen.findByRole("table");
    const calls = fetchMock.mock.calls.length;
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-19" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-01" } });
    await user.click(screen.getByRole("button", { name: "Filter" }));
    expect(screen.getByLabelText("To")).toHaveAccessibleDescription(/The end date comes before the start date./);
    expect(screen.getByLabelText("To")).toHaveFocus();
    expect(fetchMock.mock.calls).toHaveLength(calls);
  });

  it("opens and closes the details of an entry with the keyboard, its button saying whether they are shown", async () => {
    const { user } = renderAdmin("/admin/history", routes());
    await screen.findByRole("table");
    const { button } = rowOf("Details: Changed, Team wiki");
    const details = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(details).not.toBeVisible();

    button.focus();
    await user.keyboard("{Enter}");
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(details).toBeVisible();
    expect(within(details).getByText("October 19, 2026", { exact: false })).toBeInTheDocument();
    await user.keyboard(" ");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(details).not.toBeVisible();
  });

  it("shows only the fields that changed, before and after", async () => {
    const { user } = renderAdmin("/admin/history", routes());
    await screen.findByRole("table");
    const details = await open(user, /Changed, Team wiki/);
    const table = within(details).getByRole("table", { name: "Changed, Team wiki: fields" });
    expect(headers(table)).toEqual(["Field", "Before", "After"]);
    expect(rows(table)).toEqual([["Title", "Wiki", "Team wiki"]]);
  });

  it("names the check of a link and shows it as No and Yes", async () => {
    const CHECKED = entry({
      id: 9,
      action: "update",
      object: { type: "link", id: "wiki", label: "Wiki", exists: true },
      before: { ...LINK_FIELDS, title: "Wiki", check: false },
      after: { ...LINK_FIELDS, title: "Wiki", check: true },
    });
    const { user } = renderAdmin("/admin/history", routes({ "GET /api/admin/history": page([CHECKED]) }));
    await screen.findByRole("table");
    const details = await open(user, /Changed, Wiki/);
    expect(rows(within(details).getByRole("table"))).toEqual([["Check availability", "No", "Yes"]]);
  });

  it("shows a creation by the setup with its values only, Yes and No for flags, System as author", async () => {
    const { user } = renderAdmin("/admin/history", routes());
    await screen.findByRole("table");
    const details = await open(user, /Created, Zoé/);
    expect(details).toHaveTextContent("OriginSetup");
    const table = within(details).getByRole("table");
    expect(headers(table)).toEqual(["Field", "After"]);
    expect(rows(table)).toEqual([
      ["Name", "Zoé"],
      ["E-mail", "zoe@example.invalid"],
      ["Account", "Local, password"],
      ["Role", "Administrator"],
      ["Disabled", "No"],
      ["Temporary password", "No"],
      ["Groups", "(none)"],
    ]);
  });

  it("shows a deletion with its values before, what went with it listed", async () => {
    const { user } = renderAdmin("/admin/history", routes());
    await screen.findByRole("table");
    const table = within(await open(user, /Deleted, Tools/)).getByRole("table");
    expect(headers(table)).toEqual(["Field", "Before"]);
    expect(rows(table)).toEqual([
      ["Title", "Tools"],
      ["Position", "2"],
      ["Groups", "Finance, @authenticated"],
      ["Links", "Grafana"],
    ]);
  });

  it("shows a move as its position, counted from 1", async () => {
    const { user } = renderAdmin("/admin/history", routes());
    await screen.findByRole("table");
    expect(rows(within(await open(user, /Moved, Mail/)).getByRole("table"))).toEqual([["Position", "1", "2"]]);
  });

  it("shows an import as its summary, titles named, and says when its values were not kept", async () => {
    const { user } = renderAdmin("/admin/history", routes());
    await screen.findByRole("table");
    const details = await open(user, /Import, Catalog/);
    expect(within(details).queryByRole("table")).toBeNull();
    expect(details).toHaveTextContent("Added1 category: Development1 link: Git");
    expect(details).toHaveTextContent("Deleted1 link: Old intranet");
    expect(details).not.toHaveTextContent("Changed");
    expect(details).toHaveTextContent("Groups createdops");
    expect(details).toHaveTextContent("Import too large: the values before and after were not kept.");
  });

  it("names the person of a membership change", async () => {
    const { user } = renderAdmin("/admin/history", routes());
    await screen.findByRole("table");
    const details = await open(user, /Member added, Finance/);
    expect(within(details).getByRole("link", { name: "Bob" })).toHaveAttribute("href", "/admin/users/bob");
    expect(within(details).queryByRole("table")).toBeNull();
  });

  it("loads the next page after the last entry and gives the focus to the first new one", async () => {
    const OLDER = entry({ id: 3, action: "update", object: { type: "group", id: "g2", label: "Staff", exists: true }, before: { name: "Team", source: "local" }, after: { name: "Staff", source: "local" } });
    const { user, fetchMock } = renderAdmin("/admin/history", routes({ "GET /api/admin/history": page([RENAMED], 9), "GET /api/admin/history?before=9": page([OLDER]) }));
    await waitFor(() => expect(getStatus()).toHaveTextContent("1 entry shown, more to load"));
    await user.click(screen.getByRole("button", { name: "More entries" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Details: Changed, Staff" })).toHaveFocus());
    expect(fetchMock.mock.calls.map(([path]) => path)).toContain("/api/admin/history?before=9");
    expect(screen.queryByRole("button", { name: "More entries" })).toBeNull();
    expect(getStatus()).toHaveTextContent("2 entries");
  });

  it("says when no entry matches, and when the history is empty", async () => {
    renderAdmin("/admin/history?type=group", routes({ "GET /api/admin/history?type=group": page([]) }));
    expect(await screen.findByText("No change matches these filters.")).toBeInTheDocument();
    cleanup();
    renderAdmin("/admin/history", routes({ "GET /api/admin/history": page([]) }));
    expect(await screen.findByText("No changes yet.")).toBeInTheDocument();
  });
});

describe("RecentChanges", () => {
  it("shows the latest changes of a link on its page, without the item column, with a link to its whole history", async () => {
    const { fetchMock } = renderAdmin("/admin/links/wiki", linksRoutes({ "GET /api/admin/history?type=link&object=wiki&limit=5": page([RENAMED]) }));
    const block = await screen.findByRole("region", { name: "Latest changes" });
    const table = within(block).getByRole("table", { name: "Latest changes" });
    expect(headers(table)).toEqual(["Details", "When", "Who", "Action"]);
    expect(within(block).getByRole("link", { name: "All the history" })).toHaveAttribute("href", "/admin/history?type=link&object=wiki");
    expect(fetchMock.mock.calls.map(([path]) => path)).toContain("/api/admin/history?type=link&object=wiki&limit=5");
  });

  it("lists a person's memberships too, and says in one line when nothing changed", async () => {
    const BOB = person({ id: "bob", name: "Bob" });
    renderAdmin("/admin/users/bob", {
      "GET /api/admin/users": { status: 200, body: { users: [BOB] } },
      "GET /api/admin/groups": { status: 200, body: { groups: [] } },
      "GET /api/admin/history?object=bob&limit=5": page([]),
    });
    const block = await screen.findByRole("region", { name: "Latest changes" });
    expect(block).toHaveTextContent("No changes.");
    expect(within(block).queryByRole("link", { name: "All the history" })).toBeNull();
  });
  it("names the group of a person's membership, the item column being left out", async () => {
    const BOB = person({ id: "bob", name: "Bob" });
    renderAdmin("/admin/users/bob", {
      "GET /api/admin/users": { status: 200, body: { users: [BOB] } },
      "GET /api/admin/groups": { status: 200, body: { groups: [] } },
      "GET /api/admin/history?object=bob&limit=5": page([JOINED]),
    });
    const block = await screen.findByRole("region", { name: "Latest changes" });
    const table = within(block).getByRole("table", { name: "Latest changes" });
    expect(within(table).getByRole("link", { name: "Finance" })).toHaveAttribute("href", "/admin/groups/g1");
    expect(within(table).queryByRole("link", { name: "Bob" })).toBeNull();
  });
});
