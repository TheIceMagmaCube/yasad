import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectFocused, getAnnouncer, sentBody } from "../../../test-utils";
import { apiError, renderAdmin } from "../people/testing";
import { category, link, linksRoutes, primeHomeCache, STATE } from "./testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const stepTitle = () => screen.getByRole("heading", { level: 2 });
const next = () => screen.getByRole("button", { name: "Next" });

describe("AddLinks", () => {
  it("adds a link step by step, the id following the title, then lists it with its row focused and the home dropped", async () => {
    const created = link({ id: "status-page", title: "Status page", url: "https://status.example.invalid", categoryId: "dev", groups: ["local:Finance"] });
    const { user, fetchMock } = renderAdmin(
      "/admin/links",
      linksRoutes({ "POST /api/admin/links": { status: 201, body: { link: created, warnings: ["unknown_icon"] } } }),
    );
    await screen.findByRole("table", { name: "Links of Tools" });
    await user.click(screen.getByRole("link", { name: "Add" }));
    expect(location.pathname).toBe("/admin/links/new");
    expect(await screen.findByRole("heading", { level: 2, name: "What do you want to add?" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Link/ })).toBeChecked();
    expect(within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem").map((li) => li.textContent?.replace(/^\d/, ""))).toEqual([
      "Step 1 of 6: Type",
      "Step 2 of 6: Address",
      "Step 3 of 6: Category",
      "Step 4 of 6: Groups",
      "Step 5 of 6: Icon, keywords and check",
      "Step 6 of 6: Summary",
    ]);

    await user.click(next());
    expect(stepTitle()).toHaveTextContent("Address");
    expect(stepTitle()).toHaveFocus();
    await user.click(next());
    expect(screen.getByRole("group", { name: "Check the highlighted fields." })).toHaveFocus();
    await user.clear(screen.getByRole("textbox", { name: "Address" }));
    await user.type(screen.getByRole("textbox", { name: "Address" }), "https://status.example.invalid");
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Status page");
    expect(screen.getByLabelText("Identifier")).toHaveValue("status-page");
    await user.click(next());

    expect(stepTitle()).toHaveTextContent("Category");
    await user.selectOptions(screen.getByRole("combobox", { name: "Category" }), "dev");
    await user.click(next());
    expect(stepTitle()).toHaveTextContent("Groups");
    await user.click(screen.getByRole("checkbox", { name: "Finance" }));
    await user.click(next());
    expect(stepTitle()).toHaveTextContent("Icon, keywords and check");
    await user.type(screen.getByLabelText("Icon"), "si:statuspage");
    await user.type(screen.getByLabelText("Keywords"), "uptime, , incidents");
    await user.click(next());
    expect(stepTitle()).toHaveTextContent("Summary");
    expect(screen.getByText("Development")).toBeInTheDocument();
    expect(screen.getByText("uptime, incidents")).toBeInTheDocument();

    const isCached = primeHomeCache();
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(location.pathname).toBe("/admin/links"));
    const sent = sentBody(fetchMock, fetchMock.mock.calls.findIndex(([path, init]) => path === "/api/admin/links" && init?.method === "POST"));
    expect(sent).toEqual({
      id: "status-page",
      title: "Status page",
      url: "https://status.example.invalid",
      groups: ["local:Finance"],
      categoryId: "dev",
      keywords: ["uptime", "incidents"],
      icon: "si:statuspage",
    });
    await waitFor(() => expect(screen.getByRole("link", { name: "Status page" })).toHaveFocus());
    expect(within(screen.getByRole("table", { name: "Links of Development" })).getByRole("link", { name: "Status page" })).toBeInTheDocument();
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Created: Status page. Unknown icon: the first letter shows."));
    expect(isCached()).toBe(false);
  });

  it("moves the id past the ids already used and the words of other pages, and refuses one typed that is taken", async () => {
    const { user } = renderAdmin("/admin/links/new", linksRoutes());
    await user.click(await screen.findByRole("button", { name: "Next" }));
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Wiki");
    expect(screen.getByLabelText("Identifier")).toHaveValue("wiki-2");
    await user.clear(screen.getByRole("textbox", { name: "Title" }));
    await user.type(screen.getByRole("textbox", { name: "Title" }), "File");
    expect(screen.getByLabelText("Identifier")).toHaveValue("file-2");
    await user.clear(screen.getByRole("textbox", { name: "Title" }));
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Été à l'école");
    expect(screen.getByLabelText("Identifier")).toHaveValue("ete-a-l-ecole");

    await user.clear(screen.getByLabelText("Identifier"));
    await user.type(screen.getByLabelText("Identifier"), "mail");
    await user.click(next());
    expect(screen.getByRole("group", { name: "Check the highlighted fields." })).toHaveFocus();
    expect(screen.getByLabelText("Identifier")).toHaveAccessibleDescription(/This identifier is already used\./);
  });

  it("skips the icon and keywords", async () => {
    const { user, fetchMock } = renderAdmin(
      "/admin/links/new",
      linksRoutes({ "POST /api/admin/links": { status: 201, body: { link: link({ id: "x", title: "X" }), warnings: [] } } }),
    );
    await user.click(await screen.findByRole("button", { name: "Next" }));
    await user.clear(screen.getByRole("textbox", { name: "Address" }));
    await user.type(screen.getByRole("textbox", { name: "Address" }), "https://x.example.invalid");
    await user.type(screen.getByRole("textbox", { name: "Title" }), "X");
    await user.click(next());
    await user.click(next());
    await user.click(next());
    await user.type(screen.getByLabelText("Icon"), "lucide:x");
    await user.click(screen.getByRole("button", { name: "Skip" }));
    expect(stepTitle()).toHaveTextContent("Summary");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(location.pathname).toBe("/admin/links"));
    const sent = sentBody(fetchMock, fetchMock.mock.calls.findIndex(([path, init]) => path === "/api/admin/links" && init?.method === "POST")) as Record<string, unknown>;
    expect(sent.icon).toBeUndefined();
    expect(sent.keywords).toEqual([]);
  });

  /** Fill the first steps of a link and stop on the icon, keywords and check step. */
  async function toExtras(user: ReturnType<typeof renderAdmin>["user"]) {
    await user.click(await screen.findByRole("button", { name: "Next" }));
    await user.clear(screen.getByRole("textbox", { name: "Address" }));
    await user.type(screen.getByRole("textbox", { name: "Address" }), "http://nas.home.arpa");
    await user.type(screen.getByRole("textbox", { name: "Title" }), "NAS");
    await user.click(next());
    await user.click(next());
    await user.click(next());
    expect(stepTitle()).toHaveTextContent("Icon, keywords and check");
  }
  const postedLink = (fetchMock: ReturnType<typeof renderAdmin>["fetchMock"]) =>
    sentBody(fetchMock, fetchMock.mock.calls.findIndex(([path, init]) => path === "/api/admin/links" && init?.method === "POST")) as Record<string, unknown>;
  const createdNas = { "POST /api/admin/links": { status: 201, body: { link: link({ id: "nas", title: "NAS", check: true }), warnings: ["check_blocked_address"] } } };

  it("offers the availability check, unchecked, sends it when ticked and lists it in the summary", async () => {
    const { user, fetchMock } = renderAdmin("/admin/links/new", linksRoutes(createdNas));
    await toExtras(user);
    const box = screen.getByRole("checkbox", { name: "Check availability" });
    expect(box).not.toBeChecked();
    expect(box).toHaveAccessibleDescription(/every 5 min/);
    await user.click(box);
    await user.click(next());
    expect(stepTitle()).toHaveTextContent("Summary");
    const row = screen.getByText("Check availability", { selector: "dt" });
    expect(row.nextElementSibling).toHaveTextContent("Yes");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(location.pathname).toBe("/admin/links"));
    expect(postedLink(fetchMock).check).toBe(true);
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Availability check: private or local address, never contacted."));
  });

  it("sends no check and lists none in the summary when the box is left alone", async () => {
    const { user, fetchMock } = renderAdmin("/admin/links/new", linksRoutes(createdNas));
    await toExtras(user);
    await user.click(next());
    expect(screen.queryByText("Check availability")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(location.pathname).toBe("/admin/links"));
    expect(postedLink(fetchMock)).not.toHaveProperty("check");
  });

  it("drops the check when the step is skipped", async () => {
    const { user, fetchMock } = renderAdmin("/admin/links/new", linksRoutes(createdNas));
    await toExtras(user);
    await user.click(screen.getByRole("checkbox", { name: "Check availability" }));
    await user.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.queryByText("Check availability")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("checkbox", { name: "Check availability" })).not.toBeChecked();
    await user.click(next());
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(location.pathname).toBe("/admin/links"));
    expect(postedLink(fetchMock)).not.toHaveProperty("check");
  });

  it("adds a category in three steps from /admin/links/categories/new, then lists it", async () => {
    const created = category({ id: "support", title: "Support", groups: ["@everyone"] });
    const { user, fetchMock } = renderAdmin(
      "/admin/links/categories/new",
      linksRoutes({ "POST /api/admin/categories": { status: 201, body: { category: created, warnings: [] } } }),
    );
    expect(await screen.findByRole("radio", { name: /Category/ })).toBeChecked();
    expect(within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem")).toHaveLength(4);
    await user.click(next());
    expect(stepTitle()).toHaveTextContent("Title");
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Support");
    expect(screen.getByLabelText("Identifier")).toHaveValue("support");
    await user.click(next());
    expect(stepTitle()).toHaveTextContent("Groups");
    await user.click(screen.getByRole("checkbox", { name: "@everyone" }));
    await user.click(next());
    expect(stepTitle()).toHaveTextContent("Summary");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(location.pathname).toBe("/admin/links"));
    expect(sentBody(fetchMock, fetchMock.mock.calls.findIndex(([path, init]) => path === "/api/admin/categories" && init?.method === "POST"))).toEqual({
      id: "support",
      title: "Support",
      groups: ["@everyone"],
    });
    await waitFor(() => expect(screen.getByRole("link", { name: "Support" })).toHaveFocus());
  });

  it("goes back to the list with its filter after a creation", async () => {
    const created = category({ id: "devops", title: "Devops" });
    const { user } = renderAdmin("/admin/links?q=dev", linksRoutes({ "POST /api/admin/categories": { status: 201, body: { category: created, warnings: [] } } }));
    await screen.findByRole("table", { name: "Links of Development" });
    await user.click(screen.getByRole("link", { name: "Add" }));
    await user.click(await screen.findByRole("radio", { name: /Category/ }));
    await user.click(next());
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Devops");
    await user.click(next());
    await user.click(next());
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(location.pathname + location.search).toBe("/admin/links?q=dev"));
    expect(screen.getByLabelText("Filter by title, address or keyword")).toHaveValue("dev");
    // The new category matches the filter by its title, so it shows, empty, and takes the focus.
    await waitFor(() => expect(screen.getByRole("link", { name: "Devops" })).toHaveFocus());
  });

  it("offers only a category while there is none to put a link in", async () => {
    renderAdmin("/admin/links/new", linksRoutes({}, { categories: [] }));
    expect(await screen.findByRole("radio", { name: /Category/ })).toBeChecked();
    expect(screen.queryByRole("radio", { name: /Link/ })).toBeNull();
  });

  it("goes back to the step of a field the server refused", async () => {
    const { user } = renderAdmin("/admin/links/categories/new", linksRoutes({ "POST /api/admin/categories": apiError(422, "invalid_input", { id: "id_taken" }) }));
    await user.click(await screen.findByRole("button", { name: "Next" }));
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Support");
    await user.click(next());
    await user.click(next());
    await user.click(screen.getByRole("button", { name: "Create" }));
    await expectFocused(() => screen.getByRole("group", { name: "Check the highlighted fields." }));
    expect(stepTitle()).toHaveTextContent("Title");
    expect(screen.getByLabelText("Identifier")).toHaveAccessibleDescription(/This identifier is already used\./);
  });

  it("is closed under CATALOG_FILE", async () => {
    renderAdmin("/admin/links/new", linksRoutes({}, { state: { ...STATE, managedByFile: true } }));
    expect(await screen.findByText("Managed by CATALOG_FILE: read only.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });
});
