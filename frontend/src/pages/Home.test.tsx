import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HomeData } from "../api";
import { mockApi, renderWithProviders } from "../test-utils";
import { Home } from "./Home";

const ADA = { id: "ada", name: "Ada Lovelace", email: "ada@example.invalid", role: "admin" };

const link = (id: string) => ({ id, title: id.toUpperCase(), description: `${id} description`, url: `https://${id}.example.invalid`, icon: null });
const DATA: HomeData = {
  signedIn: true,
  categories: [
    { id: "b-second", title: "Second in the catalog", links: [link("zeta"), link("alpha")] },
    { id: "a-first", title: "First letter, later", links: [link("mail")] },
  ],
  empty: null,
};

const home = (body: HomeData) => ({ "GET /api/home": { status: 200, body } });
const empty = (code: HomeData["empty"]) => home({ signedIn: true, categories: [], empty: code });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Home", () => {
  it("mounts the status region empty and fills it afterwards, so it is announced", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const { container } = renderWithProviders(<Home user={ADA} />);
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    await vi.waitFor(() => expect(status).toHaveTextContent("Loading your links"));
    expect(screen.getByRole("status")).toBe(status);
    expect(container.querySelector("[data-slot=home-skeleton] [role=status]")).toBeNull();
  });

  it("shows the heading and a loading status, then the categories and links in API order", async () => {
    mockApi(home(DATA));
    renderWithProviders(<Home user={ADA} />);
    expect(screen.getByRole("heading", { level: 1, name: "My links" })).toBeInTheDocument();
    const headings = await screen.findAllByRole("heading", { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(["Second in the catalog", "First letter, later"]);
    const first = screen.getByRole("region", { name: "Second in the catalog" });
    expect(within(first).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["https://zeta.example.invalid", "https://alpha.example.invalid"]);
    expect(document.title).toBe("My links - YASAD");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
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
      ["Import the catalog", "/admin/catalog"],
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
    expect(screen.getByRole("link", { name: "Manage the catalog" })).toHaveAttribute("href", "/admin/catalog");
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

  it("shows the public links it is given without fetching", () => {
    const fetchMock = mockApi({});
    renderWithProviders(<Home user={null} initial={{ ...DATA, signedIn: false }} />);
    expect(screen.getByRole("heading", { level: 1, name: "Links" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Second in the catalog" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a session that ended on the server", async () => {
    mockApi(home({ signedIn: false, categories: [], empty: null }));
    const onSessionEnded = vi.fn();
    renderWithProviders(<Home user={ADA} onSessionEnded={onSessionEnded} />);
    await vi.waitFor(() => expect(onSessionEnded).toHaveBeenCalledTimes(1));
  });

  it("translates its texts", async () => {
    localStorage.setItem("yasad.language", "fr");
    mockApi(empty("no_groups"));
    renderWithProviders(<Home user={ADA} />);
    expect(screen.getByRole("heading", { level: 1, name: "Mes liens" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 2, name: "Pas encore d'accès" })).toBeInTheDocument();
  });
});
