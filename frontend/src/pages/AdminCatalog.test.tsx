import { cleanup, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { primeHome, useHomeEntry } from "../lib/home-store";
import { findStatus, mockApi, renderWithProviders, sentBody } from "../test-utils";
import { AdminCatalog } from "./AdminCatalog";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const YAML = "version: 1\ncategories: []\n";
const EMPTY = { categories: [], links: [] };
const preview = (diff: object) => ({
  status: 200,
  body: { applied: false, baseVersion: "v1", diff: { added: EMPTY, updated: EMPTY, removed: EMPTY, groupsCreated: [], warnings: [], ...diff } },
});

async function choose() {
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText("Catalog file"), new File([YAML], "catalog.yaml", { type: "application/yaml" }));
  return user;
}

describe("AdminCatalog", () => {
  it("previews the file, highlights deletions, then imports it", async () => {
    const fetchMock = mockApi({
      "POST /api/admin/catalog": [
        preview({ added: { categories: ["tools"], links: ["mail"] }, removed: { categories: [], links: ["jira"] }, warnings: [{ code: "no_group", kind: "link", id: "x" }, { code: "unknown_icon", kind: "link", id: "mail" }] }),
        { status: 200, body: { applied: true, baseVersion: "v1", diff: {} } },
      ],
    });
    primeHome("user:ada", { signedIn: true, categories: [], empty: null });
    const cached = renderHook(() => useHomeEntry("user:ada"));
    renderWithProviders(<AdminCatalog />);
    const user = await choose();
    expect(await screen.findByText("1 item will be deleted.")).toBeInTheDocument();
    expect(cached.result.current).not.toBeNull();
    expect(screen.getByText('Link "x" has no group: nobody can see it.')).toBeInTheDocument();
    expect(screen.getByText('Link "mail" has an icon this version does not know: it shows its first letter instead.')).toBeInTheDocument();
    expect(sentBody(fetchMock, 0)).toEqual({ yaml: YAML, dryRun: true });

    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await findStatus()).toHaveTextContent("Catalog imported.");
    expect(sentBody(fetchMock, 1)).toEqual({ yaml: YAML, dryRun: false, baseVersion: "v1" });
    // The home and the search load the new catalog next time.
    expect(cached.result.current).toBeNull();
  });

  it("says when the file changes nothing", async () => {
    mockApi({ "POST /api/admin/catalog": preview({}) });
    renderWithProviders(<AdminCatalog />);
    await choose();
    expect(await screen.findByText(/Nothing to import/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
  });

  it("lists the problems of an invalid file with their path", async () => {
    mockApi({
      "POST /api/admin/catalog": {
        status: 422,
        body: {
          error: {
            code: "invalid_catalog",
            message: "",
            errors: [
              { path: "categories[0].id", code: "invalid_id", params: {} },
              { path: "categories[1]", code: "duplicate_key", params: { key: "title" } },
              { path: "", code: "code_from_a_newer_server", params: {} },
            ],
          },
        },
      },
    });
    renderWithProviders(<AdminCatalog />);
    await choose();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("categories[0].id: Use lower-case letters, digits and dashes.");
    expect(alert).toHaveTextContent('categories[1]: The key "title" is written twice.');
    expect(alert).toHaveTextContent("Invalid value.");
  });

  it("previews the same file again once it is fixed", async () => {
    const fetchMock = mockApi({
      "POST /api/admin/catalog": [
        { status: 422, body: { error: { code: "invalid_catalog", message: "", errors: [{ path: "", code: "yaml_syntax", params: { line: 2 } }] } } },
        preview({}),
      ],
    });
    renderWithProviders(<AdminCatalog />);
    await choose();
    expect(await screen.findByRole("alert")).toHaveTextContent("YAML syntax error on line 2.");
    // A browser fires no change event for the file the field already holds.
    expect(screen.getByLabelText<HTMLInputElement>("Catalog file").value).toBe("");
    await choose();
    expect(await screen.findByText(/Nothing to import/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives the focus back to the file field on cancel", async () => {
    mockApi({ "POST /api/admin/catalog": preview({ added: { categories: ["tools"], links: [] } }) });
    renderWithProviders(<AdminCatalog />);
    const user = await choose();
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Catalog file")).toHaveFocus();
  });

  it("previews again when the catalog changed in the meantime", async () => {
    mockApi({
      "POST /api/admin/catalog": [
        preview({ added: { categories: ["tools"], links: [] } }),
        { status: 409, body: { error: { code: "catalog_changed", message: "" } } },
        preview({ added: { categories: ["tools"], links: [] } }),
      ],
    });
    renderWithProviders(<AdminCatalog />);
    const user = await choose();
    await user.click(await screen.findByRole("button", { name: "Import" }));
    expect(await screen.findByText(/changed since this preview/)).toBeInTheDocument();
  });

  it("says when the catalog is managed by a file", async () => {
    mockApi({ "POST /api/admin/catalog": { status: 409, body: { error: { code: "catalog_managed_by_file", message: "" } } } });
    renderWithProviders(<AdminCatalog />);
    await choose();
    expect(await screen.findByRole("alert")).toHaveTextContent("CATALOG_FILE");
  });
});
