import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HomeData } from "../../../api";
import { expectFocused } from "../../../test-utils";
import { renderAdmin } from "../people/testing";
import { linksRoutes, primeHomeCache } from "./testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PUBLIC: HomeData = {
  signedIn: false,
  categories: [{ id: "news", title: "News", links: [{ id: "blog", title: "Blog", description: "", url: "https://blog.example.invalid", icon: null, keywords: [] }] }],
  empty: null,
  pins: [],
};

const region = () => screen.findByRole("region", { name: "Preview of a visitor's home page" });

describe("VisitorPreview", () => {
  it("opens from the Links page and shows the public links without groups nor favourites, then back on its link", async () => {
    const isCached = primeHomeCache();
    const { user, fetchMock } = renderAdmin("/admin/links", linksRoutes({ "GET /api/admin/access/visitor/home": { status: 200, body: PUBLIC } }));
    await user.click(await screen.findByRole("link", { name: "See as a visitor" }));
    await expectFocused(() => screen.getByRole("heading", { level: 1, name: "Home page of a visitor" }));
    expect(screen.getByRole("note")).toHaveTextContent(/^Read-only preview\./);
    const preview = await region();
    expect(await within(preview).findByRole("heading", { level: 3, name: "News" })).toBeInTheDocument();
    expect(within(preview).queryByRole("complementary")).toBeNull();
    expect(screen.queryByRole("region", { name: "Groups" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(isCached()).toBe(true);
    expect(fetchMock.mock.calls.map(([path]) => String(path))).not.toContain("/api/home");

    await user.click(screen.getByRole("link", { name: "Back to Links" }));
    await expectFocused(() => screen.getByRole("link", { name: "See as a visitor" }));
  });

  it("says a visitor sees the sign-in screen when no link is public", async () => {
    renderAdmin("/admin/links/visitor/home", linksRoutes({ "GET /api/admin/access/visitor/home": { status: 200, body: { signedIn: false, categories: [], empty: null, pins: [] } } }));
    const preview = await region();
    expect(await within(preview).findByRole("heading", { level: 3, name: "No public link" })).toBeInTheDocument();
    expect(within(preview).getByText("Without a public link, a visitor sees the sign-in screen.")).toBeInTheDocument();
    expect(preview.querySelectorAll("[data-slot=home-preview]")).toHaveLength(0);
  });
});
