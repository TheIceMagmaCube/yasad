import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectFocused, getAnnouncer, sentBody } from "../../../test-utils";
import { apiError, renderAdmin } from "../people/testing";
import { DEV, GIT, linksRoutes, OLD, primeHomeCache, STATE, TOOLS, WIKI } from "./testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Return the index of the last call to `key` ("METHOD /path") in the fetch mock. */
const lastCall = (fetchMock: ReturnType<typeof renderAdmin>["fetchMock"], key: string) =>
  fetchMock.mock.calls.findLastIndex(([path, init]) => `${init?.method ?? "GET"} ${path}` === key);

describe("LinkPage", () => {
  it("shows every field of the link, then saves only what changed, announced, the home dropped, focus left on Save", async () => {
    const { user, fetchMock } = renderAdmin(
      "/admin/links/wiki",
      linksRoutes({ "PATCH /api/admin/links/wiki": { status: 200, body: { link: { ...WIKI, title: "Team wiki", revision: 2 }, warnings: [] } } }),
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Wiki" })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Wiki - Links - Administration - YASAD"));
    expect(screen.getByLabelText("Address")).toHaveValue(WIKI.url);
    expect(screen.getByLabelText("Icon")).toHaveValue("lucide:book");
    expect(screen.getByLabelText("Keywords")).toHaveValue("docs");
    expect(screen.getByLabelText("Category")).toHaveValue("tools");
    expect(screen.getByRole("checkbox", { name: "Active" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "@authenticated" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /auditors/ })).toHaveAccessibleName("auditors typed, never received");
    const isCached = primeHomeCache();

    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Team wiki");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Saved: Team wiki."));
    expect(sentBody(fetchMock, lastCall(fetchMock, "PATCH /api/admin/links/wiki"))).toEqual({ revision: 1, title: "Team wiki" });
    expect(screen.getByRole("heading", { level: 1, name: "Team wiki" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
    expect(isCached()).toBe(false);
  });

  it("after a conflict, shows the stored value under each field that differs, then overwrites it knowingly", async () => {
    const stored = { ...WIKI, title: "Wiki (old)", url: "https://elsewhere.example.invalid", keywords: ["docs", "kb"], revision: 3 };
    const { user, fetchMock } = renderAdmin(
      "/admin/links/wiki",
      linksRoutes({
        "PATCH /api/admin/links/wiki": [
          { status: 409, body: { error: { code: "item_changed", message: "", current: stored } } },
          { status: 200, body: { link: { ...stored, title: "Team wiki", revision: 4 }, warnings: [] } },
        ],
      }),
    );
    await screen.findByRole("heading", { level: 1, name: "Wiki" });
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Team wiki");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await expectFocused(() => screen.getByRole("group", { name: "Changed by someone else meanwhile. Current values are under each field." }));
    expect(screen.getByText("Current: Wiki (old)")).toBeInTheDocument();
    expect(screen.getByText("Current: https://elsewhere.example.invalid")).toBeInTheDocument();
    expect(screen.getByText("Current: docs, kb")).toBeInTheDocument();
    // What the form holds is kept, and fields that agree say nothing.
    expect(screen.getByLabelText("Title")).toHaveValue("Team wiki");
    expect(screen.queryByText(/^Current: lucide:book/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Saved: Team wiki."));
    // Sent against the stored revision: the form's address and keywords, which differ from the stored ones, go too.
    expect(sentBody(fetchMock, lastCall(fetchMock, "PATCH /api/admin/links/wiki"))).toEqual({ revision: 3, title: "Team wiki", url: WIKI.url, keywords: ["docs"] });
    expect(screen.queryByText(/^Current:/)).toBeNull();
  });

  it("shows the warnings of a save that went through", async () => {
    const { user } = renderAdmin(
      "/admin/links/wiki",
      linksRoutes({ "PATCH /api/admin/links/wiki": { status: 200, body: { link: { ...WIKI, groups: [], revision: 2 }, warnings: ["no_group"] } } }),
    );
    await screen.findByRole("heading", { level: 1, name: "Wiki" });
    await user.click(screen.getByRole("checkbox", { name: "@authenticated" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("No group: nobody sees it.")).toBeInTheDocument();
  });

  it("sends a provider group typed by hand, and saying so after the save", async () => {
    const { user, fetchMock } = renderAdmin(
      "/admin/links/wiki",
      linksRoutes({
        "PATCH /api/admin/links/wiki": { status: 200, body: { link: { ...WIKI, groups: ["@authenticated", "oidc:ops"], revision: 2 }, warnings: ["new_oidc_group"] } },
      }),
    );
    await screen.findByRole("heading", { level: 1, name: "Wiki" });
    await user.type(screen.getByLabelText("Other identity provider group"), "ops");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("New identity provider group: typed, never received.")).toBeInTheDocument();
    expect(sentBody(fetchMock, lastCall(fetchMock, "PATCH /api/admin/links/wiki"))).toEqual({ revision: 1, groups: ["@authenticated", "oidc:ops"] });
    expect(screen.getByLabelText("Other identity provider group")).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: "ops typed, never received" })).toBeChecked();
  });

  it("puts a field refused by the server on its field", async () => {
    const { user } = renderAdmin("/admin/links/wiki", linksRoutes({ "PATCH /api/admin/links/wiki": apiError(422, "invalid_input", { icon: "invalid_icon" }) }));
    await screen.findByRole("heading", { level: 1, name: "Wiki" });
    await user.clear(screen.getByLabelText("Icon"));
    await user.type(screen.getByLabelText("Icon"), "fa:book");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await expectFocused(() => screen.getByRole("group", { name: "Check the highlighted fields." }));
    expect(screen.getByLabelText("Icon")).toHaveAccessibleDescription(/Use si:<name> or lucide:<name>\./);
  });

  it("deletes the link, back on the list with a focused message in its place and the home dropped", async () => {
    const { user, fetchMock } = renderAdmin("/admin/links", linksRoutes({ "DELETE /api/admin/links/mail": { status: 204 } }));
    await screen.findByRole("table", { name: "Links of Tools" });
    await user.click(screen.getByRole("link", { name: "Mail" }));
    await screen.findByRole("heading", { level: 1, name: "Mail" });
    const isCached = primeHomeCache();
    await user.click(screen.getByRole("button", { name: "Delete Mail" }));
    await user.click(within(screen.getByRole("group", { name: "Delete the link Mail?" })).getByRole("button", { name: "Delete for good" }));
    await expectFocused(() => screen.getByRole("group", { name: "Deleted: Mail." }));
    expect(location.pathname).toBe("/admin/links");
    expect(sentBody(fetchMock, lastCall(fetchMock, "DELETE /api/admin/links/mail"))).toEqual({ revision: 1 });
    expect(isCached()).toBe(false);
  });

  it("turns read only when the server says CATALOG_FILE manages the catalog", async () => {
    const { user } = renderAdmin(
      "/admin/links/wiki",
      linksRoutes({
        "PATCH /api/admin/links/wiki": apiError(409, "catalog_managed_by_file"),
        "GET /api/admin/catalog/state": [
          { status: 200, body: STATE },
          { status: 200, body: { ...STATE, managedByFile: true } },
        ],
      }),
    );
    await screen.findByRole("heading", { level: 1, name: "Wiki" });
    await user.click(screen.getByRole("checkbox", { name: "Active" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await expectFocused(() => screen.getByRole("group", { name: "Managed by CATALOG_FILE: read only." }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).toBeNull());
    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Delete Wiki" })).toBeNull();
  });

  it("is read only under CATALOG_FILE: every field shown, disabled, no Save and no Delete", async () => {
    renderAdmin("/admin/links/old", linksRoutes({}, { state: { ...STATE, managedByFile: true } }));
    await screen.findByRole("heading", { level: 1, name: "Old intranet" });
    expect(await screen.findByText("Managed by CATALOG_FILE: read only.")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Active" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Active" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Check availability" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: `Delete ${OLD.title}` })).toBeNull();
  });

  it("sends the availability check only when it changed, with the interval in its hint", async () => {
    const { user, fetchMock } = renderAdmin(
      "/admin/links/wiki",
      linksRoutes({ "PATCH /api/admin/links/wiki": { status: 200, body: { link: { ...WIKI, check: true, revision: 2 }, warnings: [] } } }),
    );
    await screen.findByRole("heading", { level: 1, name: "Wiki" });
    const box = screen.getByRole("checkbox", { name: "Check availability" });
    expect(box).not.toBeChecked();
    expect(box).toHaveAccessibleDescription(/every 5 min\. Only public addresses are checked\. A sign-in page counts as up\./);

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(lastCall(fetchMock, "PATCH /api/admin/links/wiki")).toBe(-1);

    await user.click(box);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Saved: Wiki."));
    expect(sentBody(fetchMock, lastCall(fetchMock, "PATCH /api/admin/links/wiki"))).toEqual({ revision: 1, check: true });
  });

  it("says an inactive link is not checked, without the interval, and with it again once ticked active", async () => {
    const { user } = renderAdmin("/admin/links/old", linksRoutes());
    await screen.findByRole("heading", { level: 1, name: "Old intranet" });
    const box = screen.getByRole("checkbox", { name: "Check availability" });
    expect(box).toHaveAccessibleDescription(/^Inactive links are not checked\. Only public addresses are checked\./);
    expect(box).not.toHaveAccessibleDescription(/every 5 min/);
    await user.click(screen.getByRole("checkbox", { name: "Active" }));
    expect(box).toHaveAccessibleDescription(/^The server requests this address every 5 min\./);
  });

  it("says an inactive link is not checked in French", async () => {
    localStorage.setItem("yasad.language", "fr");
    try {
      renderAdmin("/admin/links/old", linksRoutes());
      await screen.findByRole("heading", { level: 1, name: "Old intranet" });
      expect(screen.getByRole("checkbox", { name: "Vérifier la disponibilité" })).toHaveAccessibleDescription(/^Les liens inactifs ne sont pas vérifiés\. Seules/);
    } finally {
      localStorage.removeItem("yasad.language");
    }
  });

  it("leaves the interval out of the hint when the check settings are unknown", async () => {
    renderAdmin("/admin/links/wiki", linksRoutes({ "GET /api/admin/catalog/state": apiError(500, "internal") }));
    await screen.findByRole("heading", { level: 1, name: "Wiki" });
    expect(screen.getByRole("checkbox", { name: "Check availability" })).toHaveAccessibleDescription(/^Only public addresses are checked\./);
  });

  it("after a conflict, shows the stored availability check when it differs", async () => {
    const stored = { ...WIKI, check: true, revision: 3 };
    const { user } = renderAdmin("/admin/links/wiki", linksRoutes({ "PATCH /api/admin/links/wiki": { status: 409, body: { error: { code: "item_changed", message: "", current: stored } } } }));
    await screen.findByRole("heading", { level: 1, name: "Wiki" });
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Team wiki");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Current: Check availability")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Check availability" }));
    expect(screen.queryByText("Current: Check availability")).toBeNull();
  });

  it("shows the last check of a checked link under its form, and none for an unchecked one", async () => {
    const down = { ...WIKI, check: true, status: { state: "down" as const, reason: "http_error", httpStatus: 502, checkedAt: new Date().toISOString() } };
    renderAdmin("/admin/links/wiki", linksRoutes({}, { categories: [{ ...TOOLS, links: [down, ...TOOLS.links.slice(1)] }, DEV] }));
    const region = await screen.findByRole("region", { name: "Last check" });
    expect(within(region).getByText("Down")).toBeInTheDocument();
    expect(within(region).getByText("HTTP error, HTTP 502")).toBeInTheDocument();
    cleanup();
    renderAdmin("/admin/links/mail", linksRoutes());
    await screen.findByRole("heading", { level: 1, name: "Mail" });
    expect(screen.queryByRole("region", { name: "Last check" })).toBeNull();
  });

  it("shows no last check for an inactive checked link", async () => {
    const inactive = { ...WIKI, active: false, check: true, status: { state: "down" as const, reason: "http_error", httpStatus: 502, checkedAt: new Date().toISOString() } };
    renderAdmin("/admin/links/wiki", linksRoutes({}, { categories: [{ ...TOOLS, links: [inactive, ...TOOLS.links.slice(1)] }, DEV] }));
    await screen.findByRole("heading", { level: 1, name: "Wiki" });
    expect(screen.queryByRole("region", { name: "Last check" })).toBeNull();
  });

  it("says when the address names a link that no longer exists", async () => {
    renderAdmin("/admin/links/nowhere", linksRoutes());
    expect(await screen.findByRole("heading", { level: 1, name: "This item no longer exists." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Links" })).toHaveAttribute("href", "/admin/links");
  });
  it("keeps the link page at most 1024 px wide in the wide app column", async () => {
    renderAdmin("/admin/links/wiki", linksRoutes({}));
    expect(await screen.findByRole("heading", { level: 1, name: "Wiki" })).toBeInTheDocument();
    expect(screen.getByLabelText("Address").closest(".max-w-5xl")).not.toBeNull();
  });
});

describe("CategoryPage", () => {
  it("keeps the category page at most 1024 px wide in the wide app column", async () => {
    renderAdmin("/admin/links/categories/dev", linksRoutes({}));
    expect(await screen.findByRole("heading", { level: 1, name: "Development" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title").closest(".max-w-5xl")).not.toBeNull();
  });

  it("saves the title and groups of a category, announced, the home dropped", async () => {
    const { user, fetchMock } = renderAdmin(
      "/admin/links/categories/dev",
      linksRoutes({
        "PATCH /api/admin/categories/dev": { status: 200, body: { category: { ...DEV, groups: ["oidc:developers"], revision: 2 }, warnings: [] } },
      }),
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Development" })).toBeInTheDocument();
    expect(screen.getByText("1 link")).toBeInTheDocument();
    const isCached = primeHomeCache();
    await user.click(screen.getByRole("checkbox", { name: "developers" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Saved: Development."));
    expect(sentBody(fetchMock, lastCall(fetchMock, "PATCH /api/admin/categories/dev"))).toEqual({ revision: 1, groups: ["oidc:developers"] });
    expect(isCached()).toBe(false);
  });

  it("names the links deleted with a category, and asks again with the stored count when it changed meanwhile", async () => {
    const grown = { ...TOOLS, links: [...TOOLS.links, { ...GIT, id: "new-one", categoryId: "tools" }], revision: 2 };
    const { user, fetchMock } = renderAdmin(
      "/admin/links/categories/tools",
      linksRoutes({
        "DELETE /api/admin/categories/tools": [{ status: 409, body: { error: { code: "item_changed", message: "", current: grown, linkCount: 4 } } }, { status: 204 }],
      }),
    );
    await screen.findByRole("heading", { level: 1, name: "Tools" });
    await user.click(screen.getByRole("button", { name: "Delete Tools" }));
    const confirm = screen.getByRole("group", { name: "Delete Tools and its 3 links?" });
    await user.click(within(confirm).getByRole("button", { name: "Delete for good" }));
    expect(await screen.findByRole("group", { name: "Changed by someone else meanwhile. Current values are under each field." })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Delete Tools and its 4 links?" })).toBeInTheDocument();
    expect(sentBody(fetchMock, lastCall(fetchMock, "DELETE /api/admin/categories/tools"))).toEqual({ revision: 1, linkCount: 3 });

    const isCached = primeHomeCache();
    await user.click(screen.getByRole("button", { name: "Delete for good" }));
    await waitFor(() => expect(location.pathname).toBe("/admin/links"));
    expect(sentBody(fetchMock, lastCall(fetchMock, "DELETE /api/admin/categories/tools"))).toEqual({ revision: 2, linkCount: 4 });
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Deleted: Tools."));
    expect(screen.queryByRole("table", { name: "Links of Tools" })).toBeNull();
    expect(isCached()).toBe(false);
  });
});
