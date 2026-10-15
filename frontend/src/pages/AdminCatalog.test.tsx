import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mockApi, renderWithProviders, sentBody } from "../test-utils";
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
        preview({ added: { categories: ["tools"], links: ["mail"] }, removed: { categories: [], links: ["jira"] }, warnings: ['Link "x" has no group: nobody can see it.'] }),
        { status: 200, body: { applied: true, baseVersion: "v1", diff: {} } },
      ],
    });
    renderWithProviders(<AdminCatalog />);
    const user = await choose();
    expect(await screen.findByText("1 item will be deleted.")).toBeInTheDocument();
    expect(screen.getByText(/nobody can see it/)).toBeInTheDocument();
    expect(sentBody(fetchMock, 0)).toEqual({ yaml: YAML, dryRun: true });

    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Catalog imported.");
    expect(sentBody(fetchMock, 1)).toEqual({ yaml: YAML, dryRun: false, baseVersion: "v1" });
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
        body: { error: { code: "invalid_catalog", message: "", errors: [{ path: "categories[0].id", message: "Use lower-case letters." }] } },
      },
    });
    renderWithProviders(<AdminCatalog />);
    await choose();
    expect(await screen.findByRole("alert")).toHaveTextContent("categories[0].id: Use lower-case letters.");
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
