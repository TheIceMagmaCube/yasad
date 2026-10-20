import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HomeData } from "../api";
import { invalidateHome, onViewerChanged, primeHome } from "../lib/home-store";
import { getAnnouncer, mockApi, renderWithProviders } from "../test-utils";
import { Home } from "./Home";

const ADA = { id: "ada", name: "Ada Lovelace", email: "ada@example.invalid", role: "admin" };

const link = (id: string) => ({ id, title: id.toUpperCase(), description: `${id} description`, url: `https://${id}.example.invalid`, icon: null, keywords: [] });
const DATA: HomeData = {
  signedIn: true,
  categories: [
    { id: "b-second", title: "Second in the catalog", links: [link("zeta"), link("alpha")] },
    { id: "a-first", title: "First letter, later", links: [link("mail")] },
  ],
  empty: null,
  pins: [],
};

const home = (body: HomeData) => ({ "GET /api/home": { status: 200, body } });
const empty = (code: HomeData["empty"]) => home({ signedIn: true, categories: [], empty: code, pins: [] });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Home", () => {
  it("announces the loading through the app announcer only once it lasts 300 ms", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => new Promise<Response>(() => {})),
      );
      const { container } = renderWithProviders(<Home user={ADA} />);
      act(() => vi.advanceTimersByTime(299));
      expect(getAnnouncer()).toHaveTextContent("");
      act(() => vi.advanceTimersByTime(1));
      expect(getAnnouncer()).toHaveTextContent("Loading your links");
      expect(container.querySelector("[data-slot=page-skeleton]")).toHaveClass("appear-delayed");
      expect(container.querySelector("[data-slot=page-skeleton] [role=status]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the heading and a loading status, then the categories and links in API order", async () => {
    mockApi(home(DATA));
    renderWithProviders(<Home user={ADA} />);
    expect(screen.getByRole("heading", { level: 1, name: "My links" })).toBeInTheDocument();
    await screen.findByRole("region", { name: "Second in the catalog" });
    const headings = within(document.getElementById("home-links")!).getAllByRole("heading", { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(["Second in the catalog", "First letter, later"]);
    const first = screen.getByRole("region", { name: "Second in the catalog" });
    expect(within(first).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["https://zeta.example.invalid", "https://alpha.example.invalid"]);
    await waitFor(() => expect(document.title).toBe("My links - YASAD"));
    expect(getAnnouncer()).toBeEmptyDOMElement();
  });

  it("shows an error with a retry button that stays in place, then the links", async () => {
    const user = userEvent.setup();
    mockApi({
      "GET /api/home": [
        { status: 500, body: { error: { code: "internal_error", message: "" } } },
        { status: 200, body: DATA },
      ],
    });
    renderWithProviders(<Home user={ADA} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Your links could not be loaded.");
    const retry = screen.getByRole("button", { name: "Try again" });
    await user.click(retry);
    expect(await screen.findByRole("region", { name: "Second in the catalog" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("moves the focus to the page heading when a retry succeeds", async () => {
    const user = userEvent.setup();
    mockApi({
      "GET /api/home": [
        { status: 500, body: { error: { code: "internal_error", message: "" } } },
        { status: 200, body: DATA },
      ],
    });
    renderWithProviders(
      <main>
        <Home user={ADA} />
      </main>,
    );
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await screen.findByRole("region", { name: "Second in the catalog" });
    expect(screen.getByRole("heading", { level: 1, name: "My links" })).toHaveFocus();
  });

  it("keeps the retry button focused and the alert mounted while retrying", async () => {
    const user = userEvent.setup();
    let release: (r: Response) => void = () => {};
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        calls += 1;
        if (calls === 1) return Promise.resolve(new Response(JSON.stringify({ error: { code: "internal_error", message: "" } }), { status: 500 }));
        return new Promise<Response>((resolve) => (release = resolve));
      }),
    );
    renderWithProviders(<Home user={ADA} />);
    const retry = await screen.findByRole("button", { name: "Try again" });
    await user.click(retry);
    expect(retry).toHaveFocus();
    expect(retry).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await user.click(retry);
    expect(calls).toBe(2);
    release(new Response(JSON.stringify(DATA), { status: 200 }));
    expect(await screen.findByRole("region", { name: "First letter, later" })).toBeInTheDocument();
  });

  it("guides an admin with an empty catalog through three steps", async () => {
    mockApi(empty("catalog_empty"));
    renderWithProviders(<Home user={ADA} />);
    expect(await screen.findByRole("heading", { level: 2, name: "Your catalog is empty" })).toBeInTheDocument();
    const steps = within(screen.getByRole("list")).getAllByRole("link");
    expect(steps.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Import the catalog", "/admin/links/file"],
      ["Create the groups", "/admin/groups"],
      ["Add people to the groups", "/admin/groups"],
    ]);
    expect(screen.getByRole("link", { name: "manage users" })).toHaveAttribute("href", "/admin/users");
  });

  it("tells an admin who sees nothing that groups apply to admins too", async () => {
    mockApi(empty("admin_no_access"));
    renderWithProviders(<Home user={ADA} />);
    expect(await screen.findByRole("heading", { level: 2, name: "No link is open to you" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage groups" })).toHaveAttribute("href", "/admin/groups");
    expect(screen.getByRole("link", { name: "Manage the catalog" })).toHaveAttribute("href", "/admin/links");
  });

  it.each([
    ["no_groups", "No access yet", /Contact your administrator/],
    ["nothing_visible", "Nothing to show yet", /do not open any link yet/],
    [null, "Nothing to show yet", /do not open any link yet/],
  ] as const)("explains the %s empty state without admin links", async (code, title, body) => {
    mockApi(empty(code));
    renderWithProviders(<Home user={{ ...ADA, role: "user" }} />);
    expect(await screen.findByRole("heading", { level: 2, name: title })).toBeInTheDocument();
    expect(screen.getByText(body)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows the public links the app stored without fetching", () => {
    const fetchMock = mockApi({});
    primeHome("anonymous", { ...DATA, signedIn: false });
    renderWithProviders(<Home user={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "Links" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Second in the catalog" })).toBeInTheDocument();
    expect(getAnnouncer()).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows nothing of an answer for another viewer, and reports the change", async () => {
    mockApi(home({ ...DATA, signedIn: false }));
    const changed = vi.fn();
    const stop = onViewerChanged(changed);
    const { container } = renderWithProviders(<Home user={ADA} />);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(container.querySelector("[data-slot=page-skeleton]")).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Second in the catalog" })).toBeNull();
    stop();
  });

  it("fetches the public links when the store has none", async () => {
    const fetchMock = mockApi(home({ ...DATA, signedIn: false }));
    renderWithProviders(<Home user={null} />);
    expect(await screen.findByRole("region", { name: "Second in the catalog" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows the skeleton and asks again on every visit of a signed-in person, even with data in the store", async () => {
    const fetchMock = mockApi(home(DATA));
    primeHome("user:ada", DATA);
    const { container } = renderWithProviders(<Home user={ADA} />);
    expect(container.querySelector("[data-slot=page-skeleton]")).not.toBeNull();
    expect(await screen.findByRole("region", { name: "Second in the catalog" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never shows another viewer's cached links", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    primeHome("anonymous", { ...DATA, signedIn: false });
    renderWithProviders(<Home user={ADA} />);
    expect(screen.queryByRole("region", { name: "Second in the catalog" })).toBeNull();
    invalidateHome();
  });

  describe("favourites panel", () => {
    const PINNED: HomeData = {
      signedIn: true,
      categories: [
        { id: "first", title: "First", links: [link("l1"), link("l2")] },
        { id: "second", title: "Second", links: [link("l3")] },
      ],
      empty: null,
      pins: [],
    };

    it("shows no panel to an anonymous visitor nor on an empty home", async () => {
      primeHome("anonymous", { ...PINNED, signedIn: false });
      renderWithProviders(<Home user={null} />);
      expect(screen.getByRole("region", { name: "First" })).toBeInTheDocument();
      expect(screen.queryByRole("complementary")).toBeNull();
      expect(screen.queryByRole("button", { name: "Manage favourites" })).toBeNull();
      cleanup();

      mockApi(empty("nothing_visible"));
      renderWithProviders(<Home user={ADA} />);
      expect(await screen.findByRole("heading", { level: 2, name: "Nothing to show yet" })).toBeInTheDocument();
      expect(screen.queryByRole("complementary")).toBeNull();
      expect(screen.queryByRole("button", { name: "Manage favourites" })).toBeNull();
    });

    it("invites to pin when there is no favourite, with one Manage button", async () => {
      mockApi(home(PINNED));
      renderWithProviders(<Home user={ADA} />);
      const panel = await screen.findByRole("complementary", { name: "Favourites" });
      expect(within(panel).getByText("Pin the links you open often with Manage.")).toBeInTheDocument();
      expect(within(panel).queryByRole("list")).toBeNull();
      expect(screen.getAllByRole("button", { name: "Manage favourites" })).toHaveLength(1);
      expect(screen.getByRole("button", { name: "Manage favourites" })).toHaveTextContent(/^Manage/);
    });

    it("lists the favourites in pins order and ignores unknown ids", async () => {
      mockApi(home({ ...PINNED, pins: ["l3", "gone", "l1"] }));
      renderWithProviders(<Home user={ADA} />);
      const panel = await screen.findByRole("complementary", { name: "Favourites" });
      const links = within(within(panel).getByRole("list")).getAllByRole("link");
      expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
        ["L3", "https://l3.example.invalid"],
        ["L1", "https://l1.example.invalid"],
      ]);
      expect(within(panel).queryByText("Pin the links you open often with Manage.")).toBeNull();
      // A pinned link stays in its category too.
      expect(within(screen.getByRole("region", { name: "Second" })).getByRole("link", { name: "L3" })).toBeInTheDocument();
    });

    it("puts the panel first, and its skip link leads to the categories", async () => {
      mockApi(home({ ...PINNED, pins: ["l1"] }));
      renderWithProviders(<Home user={ADA} />);
      const panel = await screen.findByRole("complementary", { name: "Favourites" });
      const target = document.getElementById("home-links")!;
      expect(panel.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(target).toHaveAttribute("tabindex", "-1");
      expect(within(target).getByRole("region", { name: "First" })).toBeInTheDocument();
      const skip = within(panel).getByRole("link", { name: "Go to the links" });
      expect(within(panel).getAllByRole("link")[0]).toBe(skip);
      expect(skip).toHaveAttribute("href", "#home-links");
    });

    it("names the aside and the section", async () => {
      mockApi(home({ ...PINNED, pins: ["l1"] }));
      renderWithProviders(<Home user={ADA} />);
      const panel = await screen.findByRole("complementary", { name: "Favourites" });
      expect(within(panel).getByRole("heading", { level: 2, name: "Favourites" })).toBeInTheDocument();
    });

    it("gives the cards two columns up to xl beside the panel", async () => {
      mockApi(home(PINNED));
      renderWithProviders(<Home user={ADA} />);
      const region = await screen.findByRole("region", { name: "First" });
      expect(within(region).getByRole("list")).toHaveClass("sm:grid-cols-2", "xl:grid-cols-3");
      expect(within(region).getByRole("list")).not.toHaveClass("lg:grid-cols-3");
    });

    it("names the panel in French", async () => {
      localStorage.setItem("yasad.language", "fr");
      mockApi(home(PINNED));
      renderWithProviders(<Home user={ADA} />);
      const panel = await screen.findByRole("complementary", { name: "Favoris" });
      expect(within(panel).getByRole("heading", { level: 2, name: "Favoris" })).toBeInTheDocument();
      expect(within(panel).getByRole("button", { name: "Gérer les favoris" })).toBeInTheDocument();
    });
  });

  it("translates its texts", async () => {
    localStorage.setItem("yasad.language", "fr");
    mockApi(empty("no_groups"));
    renderWithProviders(<Home user={ADA} />);
    expect(screen.getByRole("heading", { level: 1, name: "Mes liens" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 2, name: "Pas encore d'accès" })).toBeInTheDocument();
  });
});
