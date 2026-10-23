import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HomeData, LinkExplanation } from "../../../api";
import { listHref } from "../../../components/admin/DetailPage";
import { categoryTone } from "../../../lib/category-tone";
import { navigate } from "../../../lib/router";
import { expectFocused } from "../../../test-utils";
import { GROUPS, linksRoutes, primeHomeCache } from "../links/testing";
import { apiError, groupsAnswer, pageHeading, person, renderAdmin, usersAnswer } from "./testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BOB = person({ id: "bob", name: "Bob", groups: [{ id: "g1", name: "Finance", source: "local" }] });
const KEN = person({ id: "ken", name: "Ken", origin: "oidc", lastSignInAt: "2026-10-01T09:30:00.000Z" });
const NEW = person({ id: "new-ken", name: "Newcomer", origin: "oidc", disabled: true, mustChangePassword: true });

const card = (id: string, title: string) => ({ id, title, description: "", url: `https://${id}.example.invalid`, icon: null, keywords: [] });
/** Bob sees two categories, the second and third of the catalog: their colours follow his list, not the catalog's. */
const BOB_HOME: HomeData = {
  signedIn: true,
  categories: [
    { id: "tools", title: "Tools", links: [card("wiki", "Wiki")] },
    { id: "finance", title: "Finance desk", links: [card("ledger", "Ledger")] },
  ],
  empty: null,
  pins: ["ledger"],
};

const explained = (fields: Partial<LinkExplanation> & { id: string; title: string }): LinkExplanation => ({
  categoryId: "tools",
  categoryTitle: "Tools",
  visible: false,
  reasons: [],
  ...fields,
});
const BOB_LINKS: LinkExplanation[] = [
  explained({ id: "wiki", title: "Wiki", visible: true }),
  explained({ id: "old", title: "Old intranet", reasons: [{ code: "link_inactive" }], pinned: true }),
  explained({
    id: "git",
    title: "Git",
    categoryId: "dev",
    categoryTitle: "Development",
    reasons: [
      { code: "category_no_group" },
      {
        code: "missing_link_group",
        hint: { kind: "other_source", held: { id: "o9", name: "Dev", source: "oidc" }, expected: { id: "g9", name: "Dev", source: "local" } },
      },
    ],
  }),
  explained({
    id: "pay",
    title: "Payroll",
    categoryId: "finance",
    categoryTitle: "Finance desk",
    reasons: [
      {
        code: "missing_category_group",
        hint: { kind: "other_case", held: { id: "g1", name: "Finance", source: "local" }, expected: { id: "g8", name: "finance", source: "local" } },
      },
    ],
  }),
  explained({ id: "ledger", title: "Ledger", categoryId: "finance", categoryTitle: "Finance desk", visible: true, pinned: true }),
];

const routes = (extra = {}) => ({
  "GET /api/admin/users": usersAnswer(BOB, KEN, NEW),
  "GET /api/admin/groups": groupsAnswer(...GROUPS),
  "GET /api/admin/access/users/bob/home": { status: 200, body: BOB_HOME },
  "GET /api/admin/access/users/bob/links": { status: 200, body: { links: BOB_LINKS } },
  ...extra,
});

const preview = (name = "Bob") => screen.getByRole("region", { name: `Preview of ${name}'s home page` });
const linksTable = () => screen.findByRole("table", { name: "Links of the catalog for Bob" });
const requested = (fetchMock: ReturnType<typeof renderAdmin>["fetchMock"]) => fetchMock.mock.calls.map(([path]) => String(path));

describe("PersonPreview", () => {
  it("opens from the person's Access section, under the title of their home page, with a link back to them", async () => {
    const { user } = renderAdmin("/admin/users/bob", routes());
    await screen.findByRole("heading", { level: 1, name: "Bob" });
    const access = screen.getByRole("region", { name: "Access" });
    await user.click(within(access).getByRole("link", { name: "See their home page" }));
    await expectFocused(() => screen.getByRole("heading", { level: 1, name: "Home page of Bob" }));
    expect(location.pathname).toBe("/admin/users/bob/home");
    await waitFor(() => expect(document.title).toBe("Home page of Bob - People - Administration - YASAD"));
    expect(screen.getByRole("link", { name: "Back to Bob" })).toHaveAttribute("href", "/admin/users/bob");

    await user.click(screen.getByRole("link", { name: "Back to Bob" }));
    await expectFocused(() => within(screen.getByRole("region", { name: "Access" })).getByRole("link", { name: "See their home page" }));
  });

  it("reads the people and groups again on opening, so the groups shown match the fresh preview", async () => {
    const moved = { ...BOB, groups: [{ id: "g2", name: "Payroll team", source: "local" as const }] };
    const { user } = renderAdmin("/admin/users/bob", routes({ "GET /api/admin/users": [usersAnswer(BOB, KEN, NEW), usersAnswer(moved, KEN, NEW)] }));
    await screen.findByRole("heading", { level: 1, name: "Bob" });
    await user.click(within(screen.getByRole("region", { name: "Access" })).getByRole("link", { name: "See their home page" }));
    const groups = await screen.findByRole("region", { name: "Groups" });
    await waitFor(() => expect(within(groups).getAllByRole("listitem").map((li) => li.textContent)).toContain("Payroll team · Local"));
    expect(within(groups).queryByText("Finance")).toBeNull();
  });

  it("lets a long group name wrap, in the groups held and in a hint", async () => {
    const long = "EngineeringPlatformInfrastructureOperationsTeam";
    const held = { ...BOB, groups: [{ id: "g1", name: long, source: "local" as const }] };
    const hinted = explained({
      id: "ops",
      title: "Ops",
      reasons: [{ code: "missing_link_group", hint: { kind: "other_source", held: { id: "g1", name: long, source: "local" }, expected: { id: "o7", name: long, source: "oidc" } } }],
    });
    renderAdmin(
      "/admin/users/bob/home",
      routes({ "GET /api/admin/users": usersAnswer(held, KEN, NEW), "GET /api/admin/access/users/bob/links": { status: 200, body: { links: [hinted] } } }),
    );
    const groups = await screen.findByRole("region", { name: "Groups" });
    expect(within(groups).getByText(long).closest("li")).toHaveClass("min-w-0", "wrap-anywhere");
    const table = await linksTable();
    for (const hint of within(table).getAllByText(`They hold local:${long}, the link asks for oidc:${long}.`)) expect(hint).toHaveClass("wrap-anywhere");
  });

  it("says it is read only, and shows the person's home with h3 titles, colours by their own rank, read-only favourites", async () => {
    const isCached = primeHomeCache();
    const { fetchMock } = renderAdmin("/admin/users/bob/home", routes());
    expect(await screen.findByRole("note")).toHaveTextContent(
      "Read-only preview. You stay signed in with your own account: the search looks in your links, and a link opened here opens with your rights.",
    );
    const region = preview();
    await within(region).findByRole("heading", { level: 3, name: "Finance desk" });
    expect(within(region).getByRole("heading", { level: 2, name: "Preview" })).toBeInTheDocument();
    expect(within(region).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Favourites", "Tools", "Finance desk"]);
    const marker = (title: string) => within(region).getByRole("heading", { level: 3, name: title }).querySelector("[aria-hidden=true]")!;
    expect(marker("Tools").className).toContain(categoryTone(0).bar);
    expect(marker("Finance desk").className).toContain(categoryTone(1).bar);

    const pins = within(region).getByRole("complementary", { name: "Favourites of Bob" });
    expect(within(pins).getByRole("link", { name: "Ledger" })).toHaveAttribute("href", "https://ledger.example.invalid");
    expect(within(region).queryByRole("button")).toBeNull();
    expect(screen.queryByText("Managing favourites")).toBeNull();
    // Links stay links: the cards open the service.
    expect(within(region).getByRole("link", { name: /^Wiki/ })).toHaveAttribute("href", "https://wiki.example.invalid");

    // The administrator's own home stays as it was: the preview never reads /api/home nor writes the store.
    expect(isCached()).toBe(true);
    expect(requested(fetchMock)).not.toContain("/api/home");
  });

  it("lists the groups the person holds with their origin, the built-in ones added", async () => {
    renderAdmin("/admin/users/bob/home", routes());
    const groups = await screen.findByRole("region", { name: "Groups" });
    expect(within(groups).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["@everyone · Built-in", "@authenticated · Built-in", "Finance · Local"]);
    expect(within(groups).getByRole("link", { name: "@everyone" })).toHaveAttribute("href", "/admin/groups/system%3Aeveryone");
    expect(within(groups).getByRole("link", { name: "Finance" })).toHaveAttribute("href", "/admin/groups/g1");
  });

  it("says when the account is disabled, holds a temporary password, or comes from the provider", async () => {
    renderAdmin(
      "/admin/users/new-ken/home",
      routes({
        "GET /api/admin/access/users/new-ken/home": { status: 200, body: { signedIn: true, categories: [], empty: "no_groups", pins: [] } },
        "GET /api/admin/access/users/new-ken/links": { status: 200, body: { links: [] } },
      }),
    );
    await screen.findByRole("heading", { level: 1, name: "Home page of Newcomer" });
    const notes = screen.getAllByRole("note").map((n) => n.textContent);
    expect(notes).toContain("This account is disabled: the person cannot sign in. The preview shows what they would see once it is enabled again.");
    expect(notes).toContain("They must first change their password. The preview shows what they will see after.");
    expect(notes).toContain("No sign-in yet: no identity provider group received.");
    cleanup();

    renderAdmin(
      "/admin/users/ken/home",
      routes({
        "GET /api/admin/access/users/ken/home": { status: 200, body: BOB_HOME },
        "GET /api/admin/access/users/ken/links": { status: 200, body: { links: [] } },
      }),
    );
    await screen.findByRole("heading", { level: 1, name: "Home page of Ken" });
    // In the zone the tests run in, as the page formats it.
    const date = new Intl.DateTimeFormat("en", { dateStyle: "long", timeStyle: "short" }).format(new Date(KEN.lastSignInAt!));
    expect(screen.getAllByRole("note").map((n) => n.textContent)).toContain(`Identity provider groups read at the last sign-in, on ${date}.`);
  });

  it("shows the person's own empty state, titled h3, without the link to the administrator's groups", async () => {
    renderAdmin("/admin/users/bob/home", routes({ "GET /api/admin/access/users/bob/home": { status: 200, body: { signedIn: true, categories: [], empty: "no_groups", pins: [] } } }));
    const region = await screen.findByRole("region", { name: "Preview of Bob's home page" });
    expect(await within(region).findByRole("heading", { level: 3, name: "No access yet" })).toBeInTheDocument();
    expect(within(region).queryByRole("link", { name: "See my groups" })).toBeNull();
    expect(within(region).queryByRole("complementary")).toBeNull();
    // The empty state is its own dashed frame: none drawn around it.
    expect(region.querySelectorAll("[data-slot=home-preview]")).toHaveLength(0);
  });

  it("shows a failed preview with a retry", async () => {
    const { user } = renderAdmin("/admin/users/bob/home", routes({ "GET /api/admin/access/users/bob/home": [apiError(500, "internal"), { status: 200, body: BOB_HOME }] }));
    expect(await screen.findByText("The preview could not be loaded.")).toBeInTheDocument();
    await user.click(within(preview()).getByRole("button", { name: "Try again" }));
    expect(await within(preview()).findByRole("heading", { level: 3, name: "Tools" })).toBeInTheDocument();
  });
});

describe("PersonPreview links", () => {
  it("lists the hidden links first, each reason in a sentence with its hint under it, the pin of a hidden link told", async () => {
    renderAdmin("/admin/users/bob/home", routes());
    const table = await linksTable();
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("link")[0]!.textContent)).toEqual(["Old intranet", "Git", "Payroll"]);
    expect(screen.getByText("3 of 5 links hidden")).toBeInTheDocument();
    expect(screen.getByLabelText("Show")).toHaveValue("hidden");

    const row = (title: string) => within(table).getByRole("link", { name: title }).closest("tr")!;
    expect(within(row("Old intranet")).getAllByText("Hidden")[0]!.closest("[data-slot=state-mark]")).not.toBeNull();
    expect(within(row("Old intranet")).getAllByText("The link is inactive: nobody sees it.").length).toBeGreaterThan(0);
    expect(within(row("Old intranet")).getAllByText("Pinned by the person: it comes back with access.").length).toBeGreaterThan(0);
    expect(within(row("Git")).getAllByText("The category has no group: nobody sees its links.").length).toBeGreaterThan(0);
    expect(within(row("Git")).getAllByText("They hold none of the link's groups.").length).toBeGreaterThan(0);
    expect(within(row("Git")).getAllByText("They hold oidc:Dev, the link asks for local:Dev.").length).toBeGreaterThan(0);
    expect(within(row("Payroll")).getAllByText("They hold none of the category's groups.").length).toBeGreaterThan(0);
    expect(within(row("Payroll")).getAllByText("They hold local:Finance, the category asks for local:finance: only the case differs.").length).toBeGreaterThan(0);
    expect(within(table).getByRole("link", { name: "Git" })).toHaveAttribute("href", "/admin/links/git?as=bob&from=bob");
  });

  it("keeps the state filter in the address, the visible links in words without a mark nor a pin sentence", async () => {
    const { user } = renderAdmin("/admin/users/bob/home", routes());
    await linksTable();
    await user.selectOptions(screen.getByLabelText("Show"), "visible");
    expect(location.search).toBe("?state=visible");
    const table = screen.getByRole("table", { name: "Links of the catalog for Bob" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("link")[0]!.textContent)).toEqual(["Wiki", "Ledger"]);
    expect(within(table).queryByText("Pinned by the person: it comes back with access.")).toBeNull();
    expect(table.querySelector("[data-slot=state-mark]")).toBeNull();
    expect(within(rows[0]!).getByText("Visible")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Show"), "hidden");
    expect(location.search).toBe("");
  });

  it("opens a link's page with ?as= from a row, and gives the row the focus back on return, the filter kept", async () => {
    const { user } = renderAdmin("/admin/users/bob/home?state=visible", { ...routes(), ...linksRoutes({ "GET /api/admin/users": usersAnswer(BOB, KEN, NEW) }) });
    const table = await linksTable();
    await user.click(within(table).getByRole("link", { name: "Wiki" }));
    expect(location.pathname + location.search).toBe("/admin/links/wiki?as=bob&from=bob");
    await waitFor(() => expect(pageHeading()).toHaveTextContent("Wiki"));
    act(() => navigate(listHref("/admin/users/bob/home")));
    expect(location.search).toBe("?state=visible");
    await expectFocused(() => within(screen.getByRole("table", { name: "Links of the catalog for Bob" })).getByRole("link", { name: "Wiki" }));
  });

  it("from a hidden row, explains the link on its page, whose back link returns to the preview as left, on the row", async () => {
    const { user } = renderAdmin("/admin/users/bob/home?state=hidden", {
      ...routes(),
      ...linksRoutes({
        "GET /api/admin/users": usersAnswer(BOB, KEN, NEW),
        "GET /api/admin/access/links/old?as=bob": { status: 200, body: { audience: { people: 0, public: false }, explanation: BOB_LINKS[1] } },
      }),
    });
    await user.click(within(await linksTable()).getByRole("link", { name: "Old intranet" }));
    const who = await screen.findByRole("region", { name: "Who sees this link" });
    expect(await within(who).findByText("Bob does not see this link.")).toBeInTheDocument();
    expect(within(who).getByText("The link is inactive: nobody sees it.")).toBeInTheDocument();
    expect(within(who).getByText("Pinned by the person: it comes back with access.")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Back to Bob's home page" }));
    expect(location.pathname + location.search).toBe("/admin/users/bob/home?state=hidden");
    await expectFocused(() => within(screen.getByRole("table", { name: "Links of the catalog for Bob" })).getByRole("link", { name: "Old intranet" }));
  });

  it("says when no link is hidden", async () => {
    renderAdmin("/admin/users/bob/home", routes({ "GET /api/admin/access/users/bob/links": { status: 200, body: { links: [BOB_LINKS[0]] } } }));
    expect(await screen.findByText("No hidden link: they see every link of the catalog.")).toBeInTheDocument();
  });
});
