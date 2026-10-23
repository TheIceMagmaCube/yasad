import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LinkExplanation } from "../../../api";
import { expectFocused, getAnnouncer } from "../../../test-utils";
import { pageHeading, renderAdmin } from "../people/testing";
import { audienceAnswer, category, DEV, EMPTY, link, linksRoutes, OLD, STATE, TOOLS, WIKI } from "./testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FINANCE_WIKI = { ...WIKI, groups: ["local:Finance", "oidc:ghosts"] };
const FINANCE_TOOLS = { ...TOOLS, groups: ["@authenticated", "local:Finance"], links: [FINANCE_WIKI, OLD] };
const catalog = { categories: [FINANCE_TOOLS, DEV, EMPTY] };

const OLD_FOR_BOB: LinkExplanation = {
  id: "old",
  title: "Old intranet",
  categoryId: "tools",
  categoryTitle: "Tools",
  visible: false,
  reasons: [
    { code: "link_inactive" },
    { code: "missing_link_group" },
    {
      code: "missing_category_group",
      hint: { kind: "other_case", held: { id: "g1", name: "Finance", source: "local" }, expected: { id: "g8", name: "finance", source: "local" } },
    },
  ],
  pinned: true,
};
const OLD_FOR_KEN: LinkExplanation = { ...OLD_FOR_BOB, visible: true, reasons: [], pinned: undefined };

const section = () => screen.getByRole("region", { name: "Who sees this link" });
const requested = (fetchMock: ReturnType<typeof renderAdmin>["fetchMock"], path: string) => fetchMock.mock.calls.filter(([p]) => String(p) === path).length;

/** Hold the first request to `path` until the returned function is called; return it. */
function hold(fetchMock: ReturnType<typeof renderAdmin>["fetchMock"], path: string): () => Promise<void> {
  const run = fetchMock.getMockImplementation()!;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  let held = true;
  fetchMock.mockImplementation(async (p, init) => {
    if (held && String(p) === path) {
      held = false;
      await gate;
    }
    return run(p, init);
  });
  return () =>
    act(async () => {
      open();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
}

describe("Who sees a link", () => {
  it("lists the stored groups of the link and of its category, each linked to its group, the rule and the audience", async () => {
    renderAdmin("/admin/links/wiki", linksRoutes({ "GET /api/admin/access/links/wiki": audienceAnswer(3) }, catalog));
    await screen.findByRole("heading", { level: 1, name: "Wiki" });
    const own = within(section()).getByRole("heading", { level: 3, name: "Groups of the link" }).parentElement!;
    expect(within(own).getByRole("link", { name: "Finance" })).toHaveAttribute("href", "/admin/groups/g1");
    // A provider group no sign-in or edit stored yet has no page: its name stays text.
    expect(within(own).getByText("ghosts")).not.toHaveAttribute("href");
    const theirs = within(section()).getByRole("heading", { level: 3, name: "Groups of the category Tools" }).parentElement!;
    expect(within(theirs).getByRole("link", { name: "@authenticated" })).toHaveAttribute("href", "/admin/groups/system%3Aauthenticated");
    expect(within(theirs).getByRole("link", { name: "Finance" })).toHaveAttribute("href", "/admin/groups/g1");
    expect(within(section()).getByText("A person sees it when they hold a group from each list.")).toBeInTheDocument();
    expect(await within(section()).findByText("Seen by 3 people")).toBeInTheDocument();
    expect(within(section()).getByText("Not visible without signing in")).toBeInTheDocument();
  });

  it("says when a visitor sees the link, and offers a retry when the audience cannot be read", async () => {
    renderAdmin("/admin/links/wiki", linksRoutes({ "GET /api/admin/access/links/wiki": [{ status: 500, body: {} }, audienceAnswer(1, true)] }));
    await screen.findByRole("heading", { level: 1, name: "Wiki" });
    await within(section()).findByText("Who sees this link could not be read.");
    within(section()).getByRole("button", { name: "Try again" }).click();
    expect(await within(section()).findByText("Seen by 1 person")).toBeInTheDocument();
    expect(within(section()).getByText("Visible without signing in")).toBeInTheDocument();
  });

  it("sends and announces nothing when only the option changes; the button explains, announced, the focus left on it", async () => {
    const { user, fetchMock } = renderAdmin(
      "/admin/links/old",
      linksRoutes({ "GET /api/admin/access/links/old?as=bob": { status: 200, body: { audience: { people: 2, public: false }, explanation: OLD_FOR_BOB } } }),
    );
    await screen.findByRole("heading", { level: 1, name: "Old intranet" });
    const select = await within(section()).findByLabelText("Person");
    await user.selectOptions(select, "bob");
    await user.selectOptions(select, "ken");
    await user.selectOptions(select, "bob");
    expect(fetchMock.mock.calls.some(([p]) => String(p).includes("?as="))).toBe(false);
    expect(getAnnouncer()).toBeEmptyDOMElement();
    expect(location.search).toBe("");

    const button = within(section()).getByRole("button", { name: "Explain" });
    await user.click(button);
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent(/^Bob does not see this link\. The link is inactive: nobody sees it\./));
    expect(getAnnouncer()).toHaveTextContent("They hold local:Finance, the category asks for local:finance: only the case differs.");
    expect(button).toHaveFocus();
    expect(location.search).toBe("?as=bob");
    const result = document.getElementById(select.getAttribute("aria-describedby")!)!;
    expect(result).toHaveTextContent("Bob does not see this link.");
    expect(within(result).getByText("Pinned by the person: it comes back with access.")).toBeInTheDocument();
  });

  it("links every reason to the page that fixes it, the hint to the group it names", async () => {
    const { user } = renderAdmin(
      "/admin/links/old",
      linksRoutes({ "GET /api/admin/access/links/old?as=bob": { status: 200, body: { audience: { people: 2, public: false }, explanation: OLD_FOR_BOB } } }),
    );
    await user.selectOptions(await screen.findByLabelText("Person"), "bob");
    await user.click(screen.getByRole("button", { name: "Explain" }));
    const result = document.getElementById(screen.getByLabelText("Person").getAttribute("aria-describedby")!)!;
    await within(result).findByText("The link is inactive: nobody sees it.");
    const fixes = (text: string) => within(within(result).getByText(text).closest("li")!).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]);
    const active = screen.getByRole("checkbox", { name: "Active" });
    expect(fixes("The link is inactive: nobody sees it.")).toEqual([["Go to the Active box", `#${active.id}`]]);
    const groups = screen.getByRole("group", { name: "Groups" });
    expect(fixes("They hold none of the link's groups.")).toEqual([["Go to the groups of the link", `#${groups.id}`]]);
    expect(fixes("They hold none of the category's groups.")).toEqual([
      ["Open the category Tools", "/admin/links/categories/tools"],
      ["Open the group local:finance", "/admin/groups/g8"],
    ]);
    // A fix on the page itself focuses its field and adds no history entry, so Back still returns to where it came from.
    const before = history.length;
    await user.click(within(result).getByRole("link", { name: "Go to the groups of the link" }));
    expect(groups).toHaveFocus();
    await user.click(within(result).getByRole("link", { name: "Go to the Active box" }));
    expect(active).toHaveFocus();
    expect(location.hash).toBe("");
    expect(history.length).toBe(before);
  });

  it("opened from a preview, preselects the person, shows the explanation unannounced, and links back to the preview", async () => {
    renderAdmin("/admin/links/old?as=bob&from=bob", linksRoutes({ "GET /api/admin/access/links/old?as=bob": { status: 200, body: { audience: { people: 2, public: false }, explanation: OLD_FOR_BOB } } }));
    await screen.findByRole("heading", { level: 1, name: "Old intranet" });
    expect(await screen.findByLabelText("Person")).toHaveValue("bob");
    expect(await within(section()).findByText("Bob does not see this link.")).toBeInTheDocument();
    expect(getAnnouncer()).toBeEmptyDOMElement();
    expect(screen.getByRole("link", { name: "Back to Bob's home page" })).toHaveAttribute("href", "/admin/users/bob/home");
  });

  const explained = (as: string, body: LinkExplanation) => ({ [`GET /api/admin/access/links/old?as=${as}`]: { status: 200, body: { audience: { people: 2, public: false }, explanation: body } } });

  it("takes ?as= alone for the page's own explanation, not for a preview it was opened from", async () => {
    // Opened from the list, explained for Ken, then found again by the browser's Back.
    renderAdmin("/admin/links/old?as=ken", linksRoutes(explained("ken", OLD_FOR_KEN)));
    await screen.findByRole("heading", { level: 1, name: "Old intranet" });
    expect(await within(section()).findByText("Ken sees this link.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Back to Ken's home page" })).toBeNull();
    expect(screen.getByRole("link", { name: /^Back to / })).toHaveAttribute("href", "/admin/links");
  });

  it("keeps the back link on the preview it was opened from, whoever is explained next", async () => {
    const { user } = renderAdmin("/admin/links/old?as=bob&from=bob", linksRoutes({ ...explained("bob", OLD_FOR_BOB), ...explained("ken", OLD_FOR_KEN) }));
    await screen.findByRole("heading", { level: 1, name: "Old intranet" });
    expect(await within(section()).findByText("Bob does not see this link.")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Person"), "ken");
    await user.click(screen.getByRole("button", { name: "Explain" }));
    expect(await within(section()).findByText("Ken sees this link.")).toBeInTheDocument();
    expect(location.search).toBe("?as=ken&from=bob");
    expect(screen.getByRole("link", { name: "Back to Bob's home page" })).toHaveAttribute("href", "/admin/users/bob/home");

    // Left through a link, then found again by the browser's Back, at the address the explanation wrote.
    cleanup();
    renderAdmin(location.pathname + location.search, linksRoutes(explained("ken", OLD_FOR_KEN)));
    await screen.findByRole("heading", { level: 1, name: "Old intranet" });
    expect(await within(section()).findByText("Ken sees this link.")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Back to Bob's home page" })).toHaveAttribute("href", "/admin/users/bob/home");
  });

  it("reads the audience and the explanation again after a save", async () => {
    const saved = { ...OLD, active: true, revision: 2 };
    const { user, fetchMock } = renderAdmin(
      "/admin/links/old?as=ken",
      linksRoutes({
        "GET /api/admin/access/links/old": [audienceAnswer(0), audienceAnswer(4)],
        "GET /api/admin/access/links/old?as=ken": [
          { status: 200, body: { audience: { people: 0, public: false }, explanation: { ...OLD_FOR_KEN, visible: false, reasons: [{ code: "link_inactive" }] } } },
          { status: 200, body: { audience: { people: 4, public: false }, explanation: OLD_FOR_KEN } },
        ],
        "PATCH /api/admin/links/old": { status: 200, body: { link: saved, warnings: [] } },
      }),
    );
    await screen.findByRole("heading", { level: 1, name: "Old intranet" });
    expect(await within(section()).findByText("Ken does not see this link.")).toBeInTheDocument();
    expect(within(section()).getByText("Seen by 0 people")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Active" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await within(section()).findByText("Ken sees this link.")).toBeInTheDocument();
    await waitFor(() => expect(within(section()).getByText("Seen by 4 people")).toBeInTheDocument());
    expect(requested(fetchMock, "/api/admin/access/links/old")).toBe(2);
    // The save is what is read out, not the explanation read again behind it.
    expect(getAnnouncer()).toHaveTextContent("Saved: Old intranet.");
  });

  it("after a save, reads the explanation again for the person last asked for, and drops the answer it replaced", async () => {
    const before = { ...OLD_FOR_KEN, visible: false, reasons: [{ code: "link_inactive" as const }] };
    const { user, fetchMock } = renderAdmin(
      "/admin/links/old?as=bob",
      linksRoutes({
        ...explained("bob", OLD_FOR_BOB),
        // The request held below is answered last: it takes the second answer, the one from before the save.
        "GET /api/admin/access/links/old?as=ken": [
          { status: 200, body: { audience: { people: 2, public: false }, explanation: OLD_FOR_KEN } },
          { status: 200, body: { audience: { people: 2, public: false }, explanation: before } },
        ],
        "PATCH /api/admin/links/old": { status: 200, body: { link: { ...OLD, active: true, revision: 2 }, warnings: [] } },
      }),
    );
    await screen.findByRole("heading", { level: 1, name: "Old intranet" });
    expect(await within(section()).findByText("Bob does not see this link.")).toBeInTheDocument();
    const release = hold(fetchMock, "/api/admin/access/links/old?as=ken");
    await user.selectOptions(screen.getByLabelText("Person"), "ken");
    await user.click(screen.getByRole("button", { name: "Explain" }));
    await user.click(screen.getByRole("checkbox", { name: "Active" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await within(section()).findByText("Ken sees this link.")).toBeInTheDocument();
    // The explanation the button asked for is still read out, though its first request was replaced.
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Ken sees this link."));
    await release();
    expect(requested(fetchMock, "/api/admin/access/links/old?as=ken")).toBe(2);
    expect(within(section()).getByText("Ken sees this link.")).toBeInTheDocument();
    expect(requested(fetchMock, "/api/admin/access/links/old?as=bob")).toBe(1);
  });

  it("says the counts may be out of date when they cannot be read again after a save", async () => {
    const { user } = renderAdmin(
      "/admin/links/old",
      linksRoutes({
        "GET /api/admin/access/links/old": [audienceAnswer(3), { status: 500, body: {} }],
        "PATCH /api/admin/links/old": { status: 200, body: { link: { ...OLD, active: true, revision: 2 }, warnings: [] } },
      }),
    );
    await screen.findByRole("heading", { level: 1, name: "Old intranet" });
    expect(await within(section()).findByText("Seen by 3 people")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Active" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await within(section()).findByRole("alert")).toHaveTextContent("These counts could not be read again: they may be out of date.");
  });

  it("stays available when CATALOG_FILE manages the catalog", async () => {
    const { user } = renderAdmin(
      "/admin/links/old",
      linksRoutes(
        {
          "GET /api/admin/catalog/state": { status: 200, body: { ...STATE, managedByFile: true } },
          "GET /api/admin/access/links/old?as=ken": { status: 200, body: { audience: { people: 2, public: false }, explanation: OLD_FOR_KEN } },
        },
        catalog,
      ),
    );
    await screen.findByText("Managed by CATALOG_FILE: read only.");
    await user.selectOptions(await screen.findByLabelText("Person"), "ken");
    await user.click(screen.getByRole("button", { name: "Explain" }));
    expect(await within(section()).findByText("Ken sees this link.")).toBeInTheDocument();
  });

  it("under CATALOG_FILE, offers no fix on the page's own fields, which cannot change, but keeps the other pages", async () => {
    const { user } = renderAdmin(
      "/admin/links/old",
      linksRoutes({ "GET /api/admin/catalog/state": { status: 200, body: { ...STATE, managedByFile: true } }, ...explained("bob", OLD_FOR_BOB) }, catalog),
    );
    await screen.findByText("Managed by CATALOG_FILE: read only.");
    await user.selectOptions(await screen.findByLabelText("Person"), "bob");
    await user.click(screen.getByRole("button", { name: "Explain" }));
    await within(section()).findByText("The link is inactive: nobody sees it.");
    expect(within(section()).queryByRole("link", { name: "Go to the Active box" })).toBeNull();
    expect(within(section()).queryByRole("link", { name: "Go to the groups of the link" })).toBeNull();
    expect(within(section()).getByRole("link", { name: "Open the category Tools" })).toBeInTheDocument();
    expect(within(section()).getByRole("link", { name: "Open the group local:finance" })).toBeInTheDocument();
  });

  it("asks for a person when Explain is pressed with none chosen", async () => {
    const { user, fetchMock } = renderAdmin("/admin/links/wiki", linksRoutes());
    await user.click(await screen.findByRole("button", { name: "Explain" }));
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Choose a person first."));
    expect(fetchMock.mock.calls.some(([p]) => String(p).includes("?as="))).toBe(false);
    await expectFocused(() => screen.getByRole("button", { name: "Explain" }));
  });

  it("drops ?as= when Explain is pressed with no person, so Back does not explain again", async () => {
    const { user } = renderAdmin("/admin/links/old?as=bob", linksRoutes(explained("bob", OLD_FOR_BOB)));
    await screen.findByRole("heading", { level: 1, name: "Old intranet" });
    expect(await within(section()).findByText("Bob does not see this link.")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Person"), "");
    await user.click(screen.getByRole("button", { name: "Explain" }));
    expect(await within(section()).findByText("Choose a person first.")).toBeInTheDocument();
    expect(location.search).toBe("");
  });
});

describe("Who sees a category", () => {
  it("lists the groups of the category, who sees one of its links and whether a visitor does, read again after a save", async () => {
    const shelf = category({ id: "shelf", title: "Shelf", groups: ["@everyone"], links: [link({ id: "map", title: "Map", categoryId: "shelf" })] });
    const { user } = renderAdmin(
      "/admin/links/categories/shelf",
      linksRoutes(
        {
          "GET /api/admin/access/categories/shelf": [audienceAnswer(5, true), audienceAnswer(1, false)],
          "PATCH /api/admin/categories/shelf": { status: 200, body: { category: { ...shelf, groups: ["local:Finance"], revision: 2 }, warnings: [] } },
        },
        { categories: [shelf] },
      ),
    );
    await waitFor(() => expect(pageHeading()).toHaveTextContent("Shelf"));
    const part = screen.getByRole("region", { name: "Who sees this category" });
    expect(within(part).getByRole("link", { name: "@everyone" })).toHaveAttribute("href", "/admin/groups/system%3Aeveryone");
    expect(within(part).getByText("A person sees it when they hold one of its groups and see at least one of its links.")).toBeInTheDocument();
    expect(await within(part).findByText("Seen by 5 people")).toBeInTheDocument();
    expect(within(part).getByText("Visible without signing in")).toBeInTheDocument();
    expect(within(part).queryByLabelText("Person")).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: "@everyone" }));
    await user.click(screen.getByRole("checkbox", { name: "Finance" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await within(part).findByText("Seen by 1 person")).toBeInTheDocument();
    expect(within(part).getByText("Not visible without signing in")).toBeInTheDocument();
    expect(within(part).getByRole("link", { name: "Finance" })).toBeInTheDocument();
  });
});
