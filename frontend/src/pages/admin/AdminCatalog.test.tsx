import { cleanup, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { onStaleSession } from "../../api";
import { primeHome, useHomeEntry } from "../../lib/home-store";
import { mockApi, renderWithProviders, type Routes, sentBody } from "../../test-utils";
import { AdminCatalog } from "./AdminCatalog";
import { CHECKS } from "./links/testing";

// jsdom has no object URLs; the export creates one for the file it downloads.
for (const name of ["createObjectURL", "revokeObjectURL"] as const) {
  if (!(name in URL)) Object.defineProperty(URL, name, { value: () => "", writable: true, configurable: true });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const YAML = "version: 1\ncategories: []\n";
const NONE = { categories: [], links: [] };
const STATE = { managedByFile: false, categories: 4, links: 23, groups: 6, checks: CHECKS };
const diffOf = (diff: object) => ({ added: NONE, updated: NONE, removed: NONE, groupsCreated: [], warnings: [], labels: { categories: {}, links: {} }, ...diff });
const preview = (diff: object) => ({ status: 200, body: { applied: false, baseVersion: "v1", diff: diffOf(diff) } });

/** A preview adding a category with a link, changing a link of an unchanged category, and deleting two items. */
const FULL = {
  added: { categories: ["ops"], links: ["status"] },
  updated: { categories: [], links: ["jira"] },
  removed: { categories: ["old"], links: ["mail"] },
  labels: {
    categories: { ops: "Operations", "dev-tools": "Developer tools", old: "Old stuff", everyday: "Everyday" },
    links: { status: { title: "Status page", categoryId: "ops" }, jira: { title: "Jira Cloud", categoryId: "dev-tools" }, mail: { title: "Mail", categoryId: "everyday" } },
  },
};

const routes = (extra: Routes = {}): Routes => ({ "GET /api/admin/catalog/state": { status: 200, body: STATE }, ...extra });

async function renderPage(r: Routes) {
  const fetchMock = mockApi(r);
  renderWithProviders(<AdminCatalog />);
  await screen.findByText("4 categories, 23 links, 6 groups in use.");
  return { fetchMock, userEv: userEvent.setup() };
}

async function choose(userEv: ReturnType<typeof userEvent.setup>) {
  await userEv.upload(screen.getByLabelText("Choose a file"), new File([YAML], "catalog.yaml", { type: "application/yaml" }));
}

describe("AdminCatalog", () => {
  it("shows the summary and a file control with translated texts", async () => {
    await renderPage(routes());
    const input = screen.getByLabelText("Choose a file");
    expect(input).toHaveAttribute("accept", ".yaml,.yml,application/yaml,text/yaml");
    expect(input).toHaveAccessibleDescription(/No file chosen/);
    expect(input).toHaveAccessibleDescription(/replaces the whole catalog/);
  });

  it("previews by title, each link under its category with the ids beside, and highlights deletions", async () => {
    const { fetchMock, userEv } = await renderPage(routes({ "POST /api/admin/catalog": preview(FULL) }));
    await choose(userEv);
    const heading = await screen.findByRole("heading", { level: 2, name: "Import preview" });
    expect(heading).toHaveFocus();
    expect(sentBody(fetchMock, 1)).toEqual({ yaml: YAML, dryRun: true });
    const section = screen.getByRole("region", { name: "Import preview" });
    expect(section).toHaveTextContent("2 to add, 1 to change, 2 to delete.");

    const additions = screen.getByRole("heading", { level: 3, name: "Additions" }).parentElement!;
    const ops = within(additions).getByText("Operations").closest("li")!;
    expect(ops).toHaveTextContent("Operations ops");
    expect(within(ops).getByRole("listitem")).toHaveTextContent("Status page status");

    const changes = screen.getByRole("heading", { level: 3, name: "Changes" }).parentElement!;
    expect(within(changes).getByText("In Developer tools").closest("li")).toHaveTextContent("Jira Cloud jira");

    const deletions = screen.getByRole("heading", { level: 3, name: "Deletions" }).parentElement!;
    expect(within(deletions).getByText("Old stuff").closest("p")).toHaveTextContent("Old stuff old, to delete");
    expect(within(deletions).getByText(/^Mail/).closest("li")).toHaveTextContent("Mail mail, to delete");
    expect(screen.getByRole("button", { name: "Import and delete 2 items" })).toBeInTheDocument();
  });

  it("explains each source of the groups to create, and shows groups differing by case with their sources", async () => {
    const { userEv } = await renderPage(
      routes({
        "POST /api/admin/catalog": preview({
          added: { categories: ["tools"], links: [] },
          labels: { categories: { tools: "Tools" }, links: {} },
          groupsCreated: ["local:Staff", "oidc:Developers"],
          warnings: [
            { code: "groups_differ_by_case", groups: ["local:staff", "oidc:Staff"] },
            { code: "no_group", kind: "category", id: "tools" },
          ],
        }),
      }),
    );
    await choose(userEv);
    const section = await screen.findByRole("region", { name: "Import preview" });
    expect(section).toHaveTextContent("Created without members: add people in Groups.");
    expect(section).toHaveTextContent("Their members arrive at sign-in from the identity provider.");
    const warning = within(section).getByText("These groups differ only by case:").parentElement!;
    expect(warning).toHaveTextContent("Localstaff");
    expect(warning).toHaveTextContent("Identity providerStaff");
    expect(section).toHaveTextContent('Category "Tools" has no group: nobody can see it.');
    expect(screen.getByRole("button", { name: "Import" })).toBeInTheDocument();
  });

  it("cites an id that is also an object property as written when no title came with it", async () => {
    const { userEv } = await renderPage(
      routes({
        "POST /api/admin/catalog": preview({
          added: { categories: ["tools"], links: [] },
          labels: { categories: { tools: "Tools" }, links: {} },
          warnings: [{ code: "no_group", kind: "category", id: "constructor" }],
        }),
      }),
    );
    await choose(userEv);
    expect(await screen.findByText('Category "constructor" has no group: nobody can see it.')).toBeInTheDocument();
  });

  it("imports, shows the focused result, and drops the cached home", async () => {
    const { fetchMock, userEv } = await renderPage(
      routes({
        "POST /api/admin/catalog": [preview(FULL), { status: 200, body: { applied: true, baseVersion: "v1", diff: diffOf({ ...FULL, groupsCreated: ["local:Staff"] }) } }],
      }),
    );
    primeHome("user:ada", { signedIn: true, categories: [], empty: null, pins: [] });
    const cached = renderHook(() => useHomeEntry("user:ada"));
    await choose(userEv);
    await userEv.click(await screen.findByRole("button", { name: "Import and delete 2 items" }));
    const result = await screen.findByRole("heading", { level: 2, name: "Catalog imported" });
    expect(result).toHaveFocus();
    const section = screen.getByRole("region", { name: "Catalog imported" });
    expect(section).toHaveTextContent("2 added, 1 changed, 2 deleted.");
    expect(section).toHaveTextContent("Local groups created without members: Staff");
    expect(within(section).getByRole("link", { name: "Add people in Groups" })).toHaveAttribute("href", "/admin/groups");
    expect(sentBody(fetchMock, 2)).toEqual({ yaml: YAML, dryRun: false, baseVersion: "v1" });
    expect(cached.result.current).toBeNull();

    await userEv.click(within(section).getByRole("button", { name: "Import another file" }));
    await waitFor(() => expect(screen.getByLabelText("Choose a file")).toHaveFocus());
  });

  it("previews again when the catalog changed meanwhile, the warning focused", async () => {
    const { userEv } = await renderPage(
      routes({
        "POST /api/admin/catalog": [
          preview({ added: { categories: ["tools"], links: [] }, labels: { categories: { tools: "Tools" }, links: {} } }),
          { status: 409, body: { error: { code: "catalog_changed", message: "" } } },
          preview({ added: { categories: ["tools", "more"], links: [] }, labels: { categories: { tools: "Tools", more: "More" }, links: {} } }),
        ],
      }),
    );
    await choose(userEv);
    await userEv.click(await screen.findByRole("button", { name: "Import" }));
    const warning = await screen.findByText(/The catalog changed since the previous preview/);
    expect(warning.closest('[data-slot="alert"]')).toHaveFocus();
    expect(screen.getByRole("region", { name: "Import preview" })).toHaveTextContent("More");
  });

  it("says when the file changes nothing", async () => {
    const { userEv } = await renderPage(routes({ "POST /api/admin/catalog": preview({}) }));
    await choose(userEv);
    expect(await screen.findByText("No change.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
    await userEv.click(screen.getByRole("button", { name: "Choose another file" }));
    await waitFor(() => expect(screen.getByLabelText("Choose a file")).toHaveFocus());
  });

  it("lists the problems of an invalid file, focused, then gives the focus back to the file control", async () => {
    const { userEv } = await renderPage(
      routes({
        "POST /api/admin/catalog": {
          status: 422,
          body: { error: { code: "invalid_catalog", message: "", errors: [{ path: "categories.0.id", code: "invalid_id", params: {} }, { path: "", code: "yaml_syntax", params: { line: 3 } }] } },
        },
      }),
    );
    await choose(userEv);
    const alert = await screen.findByRole("group", { name: /This file is not a valid catalog/ });
    expect(alert).toHaveFocus();
    expect(alert).toHaveTextContent("categories.0.id: Use lower-case letters, digits and dashes.");
    expect(alert).toHaveTextContent("YAML syntax error on line 3.");
    await userEv.click(screen.getByRole("button", { name: "Choose another file" }));
    await waitFor(() => expect(screen.getByLabelText("Choose a file")).toHaveFocus());
  });

  it("offers no import while CATALOG_FILE manages the catalog", async () => {
    await renderPage({ "GET /api/admin/catalog/state": { status: 200, body: { ...STATE, managedByFile: true } } });
    expect(screen.getByText("The catalog comes from a file")).toBeInTheDocument();
    expect(screen.queryByLabelText("Choose a file")).toBeNull();
    expect(screen.getByRole("button", { name: "Export the catalog (YAML)" })).toBeInTheDocument();
  });

  it("exports through a temporary link to the file", async () => {
    const { userEv } = await renderPage(routes({ "GET /api/admin/catalog": { status: 200, body: "version: 1" } }));
    const created = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:catalog");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clicked: { download: string; href: string }[] = [];
    // Recorded, not asserted, in the mock: the export catches what a.click() throws.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href });
    });
    await userEv.click(screen.getByRole("button", { name: "Export the catalog (YAML)" }));
    await waitFor(() => expect(clicked).toEqual([{ download: "catalog.yaml", href: "blob:catalog" }]));
    expect(created).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("The catalog could not be exported.")).toBeNull();
  });

  it("shows a failed export, focused, without saving anything, and reports a lost session", async () => {
    const { userEv } = await renderPage(routes({ "GET /api/admin/catalog": { status: 401, body: { error: { code: "unauthenticated", message: "" } } } }));
    const stale = vi.fn();
    const stop = onStaleSession(stale);
    const created = vi.spyOn(URL, "createObjectURL");
    await userEv.click(screen.getByRole("button", { name: "Export the catalog (YAML)" }));
    const alert = await screen.findByText("The catalog could not be exported.");
    expect(alert.closest('[data-slot="alert"]')).toHaveFocus();
    expect(created).not.toHaveBeenCalled();
    expect(stale).toHaveBeenCalledWith("unauthenticated");
    stop();
  });
});
