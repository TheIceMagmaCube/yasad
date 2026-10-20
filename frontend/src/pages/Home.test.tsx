import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HomeData } from "../api";
import { invalidateHome, loadHome, onViewerChanged, primeHome } from "../lib/home-store";
import { getAnnouncer, mockApi, type Routes, renderWithProviders, sentBody } from "../test-utils";
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

  describe("manage mode", () => {
    const CATS: HomeData["categories"] = [
      { id: "first", title: "First", links: [link("l1"), link("l2")] },
      { id: "second", title: "Second", links: [link("l3")] },
    ];
    const data = (pins: string[]): HomeData => ({ signedIn: true, categories: CATS, empty: null, pins });
    const ok = (pins: string[]) => ({ status: 200, body: { pins } });

    /** Render the home of Ada inside main, as the app does, and wait for the panel. */
    async function renderHome(pins: string[], routes: Routes = {}) {
      const fetchMock = mockApi({ ...home(data(pins)), ...routes });
      renderWithProviders(
        <main>
          <Home user={ADA} />
        </main>,
      );
      const panel = await screen.findByRole("complementary", { name: "Favourites" });
      return { fetchMock, panel };
    }

    async function openMode(user: ReturnType<typeof userEvent.setup>) {
      const toggle = screen.getByRole("button", { name: "Manage favourites" });
      await user.click(toggle);
      return toggle;
    }

    it("turns Manage into Done on the same element and announces", async () => {
      const user = userEvent.setup();
      const { panel } = await renderHome(["l1"]);
      const toggle = await openMode(user);
      expect(within(panel).getByRole("button", { name: "Done, managing favourites" })).toBe(toggle);
      expect(toggle).toHaveTextContent(/^Done$/);
      expect(toggle).toHaveFocus();
      expect(getAnnouncer()).toHaveTextContent("Managing favourites: each link now has a Pin button.");
      expect(document.documentElement).toHaveAttribute("data-pins-managing");
      // Each card gets its button, the bar its second Done after the categories.
      expect(screen.getByRole("button", { name: "Pinned: remove L1 from favourites" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Pin L2" })).toBeInTheDocument();
      const bar = document.querySelector(".pins-bar")!;
      expect(bar).toHaveTextContent("Managing favourites");
      expect(document.getElementById("home-links")!.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("closes with either Done or Escape, focus back on Manage", async () => {
      const user = userEvent.setup();
      await renderHome(["l1"]);
      const toggle = await openMode(user);
      const bar = document.querySelector<HTMLElement>(".pins-bar")!;
      await user.click(within(bar).getByRole("button", { name: "Done, managing favourites" }));
      expect(toggle).toHaveFocus();
      expect(toggle).toHaveAccessibleName("Manage favourites");
      expect(getAnnouncer()).toHaveTextContent("Finished managing favourites");
      expect(document.querySelector(".pins-bar")).toBeNull();
      expect(document.documentElement).not.toHaveAttribute("data-pins-managing");
      expect(screen.queryByRole("button", { name: "Pin L2" })).toBeNull();

      await user.click(toggle);
      await user.click(toggle);
      expect(toggle).toHaveAccessibleName("Manage favourites");
      expect(toggle).toHaveFocus();

      await user.click(toggle);
      screen.getByRole("button", { name: "Move L1 down" }).focus();
      await user.keyboard("{Escape}");
      expect(toggle).toHaveFocus();
      expect(toggle).toHaveAccessibleName("Manage favourites");
      expect(getAnnouncer()).toHaveTextContent("Finished managing favourites");
    });

    it("Escape already handled elsewhere leaves the mode open", async () => {
      const user = userEvent.setup();
      await renderHome(["l1"]);
      const toggle = await openMode(user);
      const remove = screen.getByRole("button", { name: "Remove L1" });
      const handled = (event: KeyboardEvent) => event.preventDefault();
      remove.addEventListener("keydown", handled);
      remove.focus();
      await user.keyboard("{Escape}");
      remove.removeEventListener("keydown", handled);
      expect(toggle).toHaveAccessibleName("Done, managing favourites");
      expect(remove).toHaveFocus();
    });

    it("moves keep the focus and announce the position", async () => {
      const user = userEvent.setup();
      const { fetchMock } = await renderHome(["l1", "l3"], { "POST /api/pins/l1/move": ok(["l3", "l1"]) });
      await openMode(user);
      const down = screen.getByRole("button", { name: "Move L1 down" });
      await user.click(down);
      await waitFor(() => expect(getAnnouncer()).toHaveTextContent("L1: position 2 of 2"));
      expect(sentBody(fetchMock, 1)).toEqual({ direction: "down" });
      expect(down).toHaveFocus();
      const panel = screen.getByRole("complementary", { name: "Favourites" });
      expect(within(within(panel).getByRole("list")).getAllByRole("link").map((a) => a.textContent)).toEqual(["L3", "L1"]);
    });

    it("removing focuses the next Remove, then the previous, then the toggle", async () => {
      const user = userEvent.setup();
      await renderHome(["l1", "l2", "l3"], {
        "DELETE /api/pins/l2": ok(["l1", "l3"]),
        "DELETE /api/pins/l3": ok(["l1"]),
        "DELETE /api/pins/l1": ok([]),
      });
      const toggle = await openMode(user);
      await user.click(screen.getByRole("button", { name: "Remove L2" }));
      await waitFor(() => expect(document.activeElement).toHaveAttribute("id", "pin-remove-l3"));
      expect(getAnnouncer()).toHaveTextContent("L2 removed from favourites");
      await user.click(screen.getByRole("button", { name: "Remove L3" }));
      await waitFor(() => expect(document.activeElement).toHaveAttribute("id", "pin-remove-l1"));
      await user.click(screen.getByRole("button", { name: "Remove L1" }));
      await waitFor(() => expect(toggle).toHaveFocus());
    });

    it("removing the last favourite focuses Done and shows the managing empty text", async () => {
      const user = userEvent.setup();
      await renderHome(["l1"], { "DELETE /api/pins/l1": ok([]) });
      const toggle = await openMode(user);
      await user.click(screen.getByRole("button", { name: "Remove L1" }));
      await waitFor(() => expect(toggle).toHaveFocus());
      expect(document.activeElement).not.toBe(document.body);
      expect(toggle).toHaveAccessibleName("Done, managing favourites");
      expect(screen.getByText("No favourites. Choose Pin on a link.")).toBeInTheDocument();
    });

    it("shows a focused error with the cap from the answer", async () => {
      const user = userEvent.setup();
      await renderHome(["l1"], { "POST /api/pins": { status: 409, body: { error: { code: "pins_full", message: "", max: 20 } } } });
      await openMode(user);
      await user.click(screen.getByRole("button", { name: "Pin L2" }));
      const panel = screen.getByRole("complementary", { name: "Favourites" });
      await waitFor(() => expect(panel.querySelector("[data-slot=alert]")).toHaveFocus());
      expect(panel.querySelector("[data-slot=alert]")).toHaveTextContent("You have reached the maximum of 20 favourites. Remove one to add another.");
    });

    it("shows the save error for any other failure", async () => {
      const user = userEvent.setup();
      await renderHome(["l1"], { "DELETE /api/pins/l1": { status: 500, body: { error: { code: "internal_error", message: "" } } } });
      await openMode(user);
      await user.click(screen.getByRole("button", { name: "Remove L1" }));
      const panel = screen.getByRole("complementary", { name: "Favourites" });
      await waitFor(() => expect(panel.querySelector("[data-slot=alert]")).toHaveFocus());
      expect(panel.querySelector("[data-slot=alert]")).toHaveTextContent("Your favourites could not be saved. Try again.");
      // The alert goes with the mode, and does not come back when it opens again.
      const toggle = document.getElementById("pins-toggle")!;
      await user.click(toggle);
      expect(panel.querySelector("[data-slot=alert]")).toBeNull();
      await user.click(toggle);
      expect(panel.querySelector("[data-slot=alert]")).toBeNull();
      expect(toggle).toHaveFocus();
    });

    it("reloads without reset after not_found and stays in the mode", async () => {
      const user = userEvent.setup();
      const fetchMock = mockApi({
        "GET /api/home": [
          { status: 200, body: data(["l1"]) },
          { status: 200, body: { ...data(["l1"]), categories: [CATS[0]!] } },
        ],
        "POST /api/pins": { status: 404, body: { error: { code: "not_found", message: "" } } },
      });
      const { container } = renderWithProviders(
        <main>
          <Home user={ADA} />
        </main>,
      );
      await screen.findByRole("complementary", { name: "Favourites" });
      const toggle = await openMode(user);
      await user.click(screen.getByRole("button", { name: "Pin L3" }));
      const panel = screen.getByRole("complementary", { name: "Favourites" });
      await waitFor(() => expect(panel.querySelector("[data-slot=alert]")).toHaveTextContent("This link is no longer available."));
      await waitFor(() => expect(screen.queryByRole("region", { name: "Second" })).toBeNull());
      expect(fetchMock.mock.calls.filter(([path]) => path === "/api/home")).toHaveLength(2);
      expect(container.querySelector("[data-slot=page-skeleton]")).toBeNull();
      expect(toggle).toHaveAccessibleName("Done, managing favourites");
      expect(screen.getByRole("button", { name: "Pin L2" })).toBeInTheDocument();
    });

    it("applies the order of the last of two quick gestures", async () => {
      const user = userEvent.setup();
      const answers: Record<string, ((r: Response) => void)[]> = {};
      const fetchMock = vi.fn((path: string, init?: RequestInit) => {
        const key = `${init?.method ?? "GET"} ${path}`;
        if (key === "GET /api/home") return Promise.resolve(new Response(JSON.stringify(data(["l1", "l2", "l3"])), { status: 200 }));
        return new Promise<Response>((resolve) => (answers[key] ??= []).push(resolve));
      });
      vi.stubGlobal("fetch", fetchMock);
      renderWithProviders(
        <main>
          <Home user={ADA} />
        </main>,
      );
      await screen.findByRole("complementary", { name: "Favourites" });
      await openMode(user);
      const down = screen.getByRole("button", { name: "Move L1 down" });
      const up = screen.getByRole("button", { name: "Move L3 up" });
      await user.click(down);
      await user.click(up);
      expect(down).toHaveAttribute("aria-disabled", "true");
      expect(up).toHaveAttribute("aria-disabled", "true");
      // One gesture in flight: the second waits for the first answer.
      expect(answers["POST /api/pins/l3/move"]).toBeUndefined();
      const order = () =>
        within(within(screen.getByRole("complementary", { name: "Favourites" })).getByRole("list"))
          .getAllByRole("link")
          .map((a) => a.textContent);
      await act(async () => answers["POST /api/pins/l1/move"]![0]!(new Response(JSON.stringify({ pins: ["l2", "l1", "l3"] }), { status: 200 })));
      await waitFor(() => expect(answers["POST /api/pins/l3/move"]).toHaveLength(1));
      expect(order()).toEqual(["L2", "L1", "L3"]);
      await act(async () => answers["POST /api/pins/l3/move"]![0]!(new Response(JSON.stringify({ pins: ["l2", "l3", "l1"] }), { status: 200 })));
      await waitFor(() => expect(order()).toEqual(["L2", "L3", "L1"]));
      await waitFor(() => expect(up).not.toHaveAttribute("aria-disabled"));
    });

    it("closes the mode on a session change", async () => {
      const user = userEvent.setup();
      await renderHome(["l1"]);
      await openMode(user);
      screen.getByRole("button", { name: "Remove L1" }).focus();
      mockApi(home(data([])));
      act(() => {
        invalidateHome();
        loadHome("user:ada");
      });
      const toggle = await screen.findByRole("button", { name: "Manage favourites" });
      expect(toggle).toHaveTextContent(/^Manage$/);
      expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "My links" }));
      expect(document.documentElement).not.toHaveAttribute("data-pins-managing");
      expect(document.querySelector(".pins-bar")).toBeNull();
    });

    it("announces a pin with its position and an unpin", async () => {
      const user = userEvent.setup();
      await renderHome(["l1"], { "POST /api/pins": ok(["l1", "l2"]), "DELETE /api/pins/l2": ok(["l1"]) });
      await openMode(user);
      const card = screen.getByRole("button", { name: "Pin L2" });
      await user.click(card);
      await waitFor(() => expect(getAnnouncer()).toHaveTextContent("L2 pinned, position 2 of 2"));
      expect(card).toHaveFocus();
      expect(card).toHaveAccessibleName("Pinned: remove L2 from favourites");
      const scrolls = vi.mocked(Element.prototype.scrollIntoView).mock;
      expect(scrolls.contexts.at(-1)).toBe(card);
      expect(scrolls.calls.at(-1)).toEqual([{ block: "nearest" }]);
      await user.click(card);
      await waitFor(() => expect(getAnnouncer()).toHaveTextContent("L2 removed from favourites"));
      expect(card).toHaveAccessibleName("Pin L2");
      expect(card).toHaveFocus();
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
