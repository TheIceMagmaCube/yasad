import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectFocused, getAnnouncer } from "../../../test-utils";
import { renderAdmin } from "../people/testing";
import { CHECKS, category, link, linksRoutes, primeHomeCache, STATE, WIKI } from "./testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const table = (category: string) => screen.getByRole("table", { name: `Links of ${category}` });
const rowTitles = () => screen.queryAllByRole("link", { name: /^(Wiki|Mail|Old intranet|Git)$/ }).map((a) => a.textContent);

describe("LinksPage", () => {
  it("shows one table per category in the stored order, each link with its one abnormal state", async () => {
    renderAdmin("/admin/links", linksRoutes());
    await screen.findByRole("table", { name: "Links of Tools" });
    await waitFor(() => expect(document.title).toBe("Links - Administration - YASAD"));
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Tools", "Development", "Empty shelf"]);
    expect(screen.getByRole("link", { name: "Tools" })).toHaveAttribute("href", "/admin/links/categories/tools");
    expect(within(table("Tools")).getByRole("link", { name: "Wiki" })).toHaveAttribute("href", "/admin/links/wiki");
    const stateOf = (title: string) => within(table(title === "Git" ? "Development" : "Tools")).getByRole("link", { name: title }).closest("tr")!;
    expect(stateOf("Mail")).toHaveTextContent("No group: nobody sees it");
    expect(stateOf("Old intranet")).toHaveTextContent("Inactive");
    expect(stateOf("Git")).toHaveTextContent("Typed group, never received");
    expect(stateOf("Wiki")).not.toHaveTextContent(/Inactive|No group|Unknown icon|never received/);
    expect(screen.getByText("No links.")).toBeInTheDocument();
    expect(screen.getByText("4 links")).toBeInTheDocument();
  });

  it("puts the filter, the count and Add, Reorder, YAML file on the toolbar, with no hero", async () => {
    renderAdmin("/admin/links", linksRoutes());
    await screen.findByRole("table", { name: "Links of Tools" });
    const toolbar = document.querySelector<HTMLElement>('[data-slot="admin-toolbar"]')!;
    const controls = [...toolbar.querySelectorAll<HTMLElement>("input, a, button")].map((el) => (el instanceof HTMLInputElement ? el.placeholder : el.textContent));
    expect(controls).toEqual(["Filter by title, address or keyword", "Add", "Reorder", "YAML file"]);
    expect(within(toolbar).getByRole("link", { name: "Add" })).toHaveAttribute("href", "/admin/links/new");
    expect(within(toolbar).getByRole("link", { name: "YAML file" })).toHaveAttribute("href", "/admin/links/file");
    expect(document.querySelector('[data-slot="pixel-scene"]')).toBeNull();
  });

  it("filters by title, address or keyword from ?q=, a category whose title matches keeping its links", async () => {
    const { user } = renderAdmin("/admin/links?q=docs", linksRoutes());
    await screen.findByRole("table", { name: "Links of Tools" });
    expect(rowTitles()).toEqual(["Wiki"]);
    expect(screen.getByText("1 of 4 links")).toBeInTheDocument();
    const filter = screen.getByLabelText("Filter by title, address or keyword");
    await user.clear(filter);
    await user.type(filter, "develop");
    expect(location.search).toBe("?q=develop");
    expect(rowTitles()).toEqual(["Git"]);
  });

  it.each([
    ["noGroup", "No group: nobody sees it", ["Mail"], ["Tools", "Development"]],
    ["inactive", "Inactive", ["Old intranet"], ["Tools"]],
    ["unknownIcon", "Unknown icon", ["Git"], ["Development"]],
    ["neverReceived", "Typed group, never received", ["Git"], ["Development"]],
  ])("narrows the list to ?state=%s, which Show all clears", async (state, label, links, sections) => {
    const { user } = renderAdmin(`/admin/links?state=${state}`, linksRoutes());
    await screen.findAllByRole("heading", { level: 2 });
    expect(screen.getByText(`Filter: ${label}`)).toBeInTheDocument();
    expect(rowTitles()).toEqual(links);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(sections);
    await user.click(screen.getByRole("button", { name: "Show all" }));
    expect(location.search).toBe("");
    expect(rowTitles()).toEqual(["Wiki", "Mail", "Old intranet", "Git"]);
  });

  it("ignores an unknown ?state=", async () => {
    renderAdmin("/admin/links?state=whatever", linksRoutes());
    await screen.findByRole("table", { name: "Links of Tools" });
    expect(rowTitles()).toHaveLength(4);
    expect(screen.queryByText(/^Filter:/)).toBeNull();
  });

  it("is read only under CATALOG_FILE: everything shown, no Add and no Reorder", async () => {
    renderAdmin("/admin/links", linksRoutes({}, { state: { ...STATE, managedByFile: true } }));
    expect(await screen.findByText("Managed by CATALOG_FILE: read only.")).toBeInTheDocument();
    expect(rowTitles()).toEqual(["Wiki", "Mail", "Old intranet", "Git"]);
    expect(screen.queryByRole("link", { name: "Add" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reorder" })).toBeNull();
    expect(screen.getByRole("link", { name: "YAML file" })).toBeInTheDocument();
  });

  it("says when the catalog is empty", async () => {
    renderAdmin("/admin/links", linksRoutes({}, { categories: [] }));
    expect(await screen.findByText("No category yet")).toBeInTheDocument();
  });
});

describe("Link status in the list", () => {
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const status = (state: "up" | "down" | "unknown", checkedAt: string, reason: string | null = null, httpStatus: number | null = null) => ({ state, reason, httpStatus, checkedAt });
  const UP = link({ id: "up", title: "Up", check: true, status: status("up", ago(1), null, 200) });
  const DOWN = link({ id: "down", title: "Down", check: true, status: status("down", ago(1), "http_error", 502) });
  const NEW = link({ id: "new", title: "New", check: true });
  const STALE = link({ id: "stale", title: "Stale", check: true, status: status("up", ago(16), null, 200) });
  const OFF = link({ id: "off", title: "Off", check: true, active: false, status: status("down", ago(1), "timeout") });
  const CHECKED = category({ id: "tools", title: "Tools", links: [UP, DOWN, NEW, STALE, OFF] });
  const routes = (state = STATE) => linksRoutes({}, { categories: [CHECKED], state });
  const titles = () => screen.queryAllByRole("link", { name: /^(Up|Down|New|Stale|Off)$/ }).map((a) => a.textContent);
  const rowOf = (title: string) => within(table("Tools")).getByRole("link", { name: title }).closest("tr")!;

  it("marks a down link, an unchecked or stale one as status unknown, and an inactive one as inactive only", async () => {
    renderAdmin("/admin/links", routes());
    await screen.findByRole("table", { name: "Links of Tools" });
    expect(rowOf("Down").querySelector("td:last-child")).toHaveTextContent(/^Down$/);
    expect(rowOf("Up").querySelector("td:last-child")).toHaveTextContent(/^$/);
    expect(rowOf("New")).toHaveTextContent("Status unknown");
    expect(rowOf("Stale")).toHaveTextContent("Status unknown");
    expect(rowOf("Off").querySelector("td:last-child")).toHaveTextContent(/^Inactive$/);
  });

  it("ranks a missing group above a down status", async () => {
    const orphan = link({ id: "down", title: "Down", groups: [], check: true, status: status("down", ago(1), "http_error", 502) });
    renderAdmin("/admin/links", linksRoutes({}, { categories: [category({ id: "tools", title: "Tools", links: [orphan] })] }));
    await screen.findByRole("table", { name: "Links of Tools" });
    expect(rowOf("Down").querySelector("td:last-child")).toHaveTextContent(/^No group: nobody sees it$/);
  });

  it.each([
    ["down", "Down", ["Down"]],
    ["statusUnknown", "Status unknown", ["New", "Stale"]],
  ])("narrows the list to ?state=%s, active links only", async (state, label, links) => {
    renderAdmin(`/admin/links?state=${state}`, routes());
    await screen.findByRole("table", { name: "Links of Tools" });
    expect(screen.getByText(`Filter: ${label}`)).toBeInTheDocument();
    expect(titles()).toEqual(links);
  });

  it("says when nothing is down", async () => {
    renderAdmin("/admin/links?state=down", linksRoutes());
    expect(await screen.findByText("Nothing in this state.")).toBeInTheDocument();
  });

  it.each([
    [51, 50, true],
    [50, 50, false],
    [80, null, false],
  ])("with %s checked links and a capacity of %s, warns: %s", async (checked, capacity, warns) => {
    renderAdmin("/admin/links", routes({ ...STATE, checks: { ...CHECKS, checked, capacity } }));
    await screen.findByRole("table", { name: "Links of Tools" });
    const text = "51 links are checked, but this instance can check 50 per interval. Some statuses will turn unknown. Check fewer links or raise STATUS_CHECK_INTERVAL_MINUTES.";
    if (warns) expect(screen.getByText(text)).toBeInTheDocument();
    else expect(screen.queryByText(/per interval/)).toBeNull();
  });

  it("reads the marks and the warning in French", async () => {
    localStorage.setItem("yasad.language", "fr");
    try {
      renderAdmin("/admin/links", routes({ ...STATE, checks: { ...CHECKS, checked: 51, capacity: 50 } }));
      await screen.findByRole("table", { name: "Liens de Tools" });
      expect(screen.getByText("En panne")).toBeInTheDocument();
      expect(screen.getAllByText("Statut inconnu")).toHaveLength(2);
      expect(screen.getByText(/^51 liens sont vérifiés, mais cette instance peut en vérifier 50 par intervalle\./)).toBeInTheDocument();
    } finally {
      localStorage.removeItem("yasad.language");
    }
  });
});

describe("Reorder mode", () => {
  it("moves a category with the keyboard: focus kept on the button, position announced, home dropped, edges aria-disabled", async () => {
    const { user, fetchMock } = renderAdmin(
      "/admin/links",
      linksRoutes({ "POST /api/admin/categories/tools/move": { status: 200, body: { order: ["dev", "tools", "empty"] } } }),
    );
    await screen.findByRole("table", { name: "Links of Tools" });
    const isCached = primeHomeCache();
    await user.click(screen.getByRole("button", { name: "Reorder" }));
    const mode = screen.getByRole("group", { name: "Reorder" });
    expect(within(mode).getByRole("button", { name: "Categories" })).toHaveAttribute("aria-pressed", "true");
    expect(within(mode).getByRole("button", { name: "Links" })).toHaveAttribute("aria-pressed", "false");

    const up = screen.getByRole("button", { name: "Move up the category Tools" });
    expect(up).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Move down the category Empty shelf" })).toHaveAttribute("aria-disabled", "true");
    await user.click(up);
    expect(fetchMock.mock.calls.some(([path]) => path === "/api/admin/categories/tools/move")).toBe(false);

    const down = screen.getByRole("button", { name: "Move down the category Tools" });
    down.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Tools: position 2 of 3"));
    expect(screen.getByRole("button", { name: "Move down the category Tools" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Move up the category Tools" })).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("button", { name: "Move up the category Development" })).toHaveAttribute("aria-disabled", "true");
    expect(within(screen.getByRole("list", { name: "Categories" })).getAllByRole("listitem").map((li) => li.textContent?.split(/\d/)[0])).toEqual(["Development", "Tools", "Empty shelf"]);
    expect(isCached()).toBe(false);
  });

  it("moves a link within its category in the Links view, announcing its place in that category", async () => {
    const { user } = renderAdmin("/admin/links", linksRoutes({ "POST /api/admin/links/mail/move": { status: 200, body: { order: ["mail", "wiki", "old"] } } }));
    await screen.findByRole("table", { name: "Links of Tools" });
    await user.click(screen.getByRole("button", { name: "Reorder" }));
    await user.click(screen.getByRole("button", { name: "Links" }));
    expect(screen.getByRole("button", { name: "Links" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /Move (up|down) the category/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Move up the link Git" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Move down the link Git" })).toHaveAttribute("aria-disabled", "true");

    await user.click(screen.getByRole("button", { name: "Move up the link Mail" }));
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Mail: position 1 of 3 in Tools"));
    expect(screen.getByRole("button", { name: "Move up the link Mail" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Move up the link Mail" })).toHaveAttribute("aria-disabled", "true");
    const tools = screen.getByRole("region", { name: "Tools" });
    expect(within(tools).getAllByRole("listitem").map((li) => li.textContent?.replace(/^\d+/, "").split("Move")[0])).toEqual(["Mail", "Wiki", "Old intranet"]);
  });

  it("shows a refused move, reads the list again, and Done goes back to the list on Reorder", async () => {
    const { user, fetchMock } = renderAdmin(
      "/admin/links",
      linksRoutes({
        "POST /api/admin/links/wiki/move": { status: 409, body: { error: { code: "item_changed", message: "", current: { ...WIKI, categoryId: "dev" } } } },
      }),
    );
    await screen.findByRole("table", { name: "Links of Tools" });
    await user.click(screen.getByRole("button", { name: "Reorder" }));
    await user.click(screen.getByRole("button", { name: "Links" }));
    await user.click(screen.getByRole("button", { name: "Move down the link Wiki" }));
    await expectFocused(() => screen.getByRole("group", { name: "This link went to another category meanwhile. The list has been read again." }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([path]) => path === "/api/admin/categories")).toHaveLength(2));

    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reorder" })).toHaveFocus());
    expect(screen.getByRole("table", { name: "Links of Tools" })).toBeInTheDocument();
  });

  it("offers no reorder when the catalog has no category", async () => {
    renderAdmin("/admin/links", linksRoutes({}, { categories: [] }));
    await screen.findByText("No category yet");
    expect(screen.getByRole("button", { name: "Reorder" })).toBeDisabled();
  });
});

describe("YAML file page", () => {
  it("holds the import and export under Links, with a way back", async () => {
    renderAdmin("/admin/links/file", linksRoutes());
    expect(await screen.findByRole("heading", { level: 1, name: "YAML file" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Links", current: "page" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Links" })).toHaveAttribute("href", "/admin/links");
    expect(await screen.findByRole("button", { name: "Export the catalog (YAML)" })).toBeInTheDocument();
  });
});
