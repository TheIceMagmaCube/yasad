import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { navigate } from "./lib/router";
import { leavePage } from "./lib/sign-in";
import { mockApi, type Routes } from "./test-utils";

const ADA = { name: "Ada Lovelace", email: "ada@example.invalid", role: "admin" };
const BOB = { name: "Bob", email: "bob@example.invalid", role: "user" };
const CATEGORY = {
  id: "everyday",
  title: "Everyday",
  links: [{ id: "mail", title: "Mail", description: "Company mailbox", url: "https://mail.example.invalid", icon: null, keywords: [] }],
};

/** Home answer of an anonymous visitor on an instance with no public link. */
const NO_PUBLIC_LINKS: Routes = { "GET /api/home": { status: 200, body: { signedIn: false, categories: [], empty: null, pins: [] } } };

/** Return the API answers for a signed-in person, admin lists included. */
function signedIn(user: object): Routes {
  return {
    "GET /api/setup": { status: 200, body: { open: false } },
    "GET /api/auth/get-session": { status: 200, body: { user, session: {} } },
    "GET /api/home": { status: 200, body: { signedIn: true, categories: [], empty: "nothing_visible", pins: [] } },
    "GET /api/admin/users": { status: 200, body: { users: [] } },
    "GET /api/admin/groups": { status: 200, body: { groups: [] } },
    "GET /api/admin/catalog/state": { status: 200, body: { managedByFile: false, categories: 0, links: 0, groups: 0 } },
    "GET /api/admin/categories": { status: 200, body: { categories: [] } },
  };
}

/** Open the account menu of `name` and return it. */
async function openAccountMenu(user: ReturnType<typeof userEvent.setup>, name: string): Promise<HTMLElement> {
  await user.click(screen.getByRole("button", { name: `Account menu for ${name}` }));
  return screen.getByRole("menu");
}

/** Render the app on `path`. */
function renderAt(path: string) {
  history.replaceState(null, "", path);
  return render(<App />);
}

afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-mode");
});

describe("App", () => {
  it("shows the setup flow while setup is open and nobody is signed in", async () => {
    mockApi({ "GET /api/setup": { status: 200, body: { open: true } }, "GET /api/auth/get-session": { status: 200, body: null },
      ...NO_PUBLIC_LINKS });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Set up YASAD" })).toBeInTheDocument();
  });

  it("shows the sign-in screen once setup is closed", async () => {
    mockApi({ "GET /api/setup": { status: 200, body: { open: false } }, "GET /api/auth/get-session": { status: 200, body: null },
      ...NO_PUBLIC_LINKS });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("shows the home page to a signed-in user", async () => {
    mockApi({
      "GET /api/setup": { status: 200, body: { open: false, setupCodeStillSet: false } },
      "GET /api/auth/get-session": { status: 200, body: { user: ADA, session: {} } },
      "GET /api/home": { status: 200, body: { signedIn: true, categories: [CATEGORY], empty: null, pins: [] } },
    });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "My links", level: 1 })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Mail" })).toHaveAttribute("href", "https://mail.example.invalid");
  });

  it("applies the instance title, theme and language, and caches them", async () => {
    vi.stubGlobal("navigator", { ...navigator, languages: ["de-DE"] });
    mockApi({
      "GET /api/instance": { status: 200, body: { title: "Home lab", logo: null, theme: "dusk", defaultLanguage: "fr", passwordSignIn: true } },
      "GET /api/setup": { status: 200, body: { open: false } },
      "GET /api/auth/get-session": { status: 200, body: null },
      ...NO_PUBLIC_LINKS,
    });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Connexion" })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Connexion - Home lab"));
    expect(document.documentElement).toHaveAttribute("data-theme", "dusk");
    expect(document.documentElement).toHaveAttribute("lang", "fr");
    expect(localStorage.getItem("yasad.instanceTheme")).toBe("dusk");
    expect(localStorage.getItem("yasad.instanceLanguage")).toBe("fr");
  });

  it("keeps the cached instance settings when /api/instance fails", async () => {
    localStorage.setItem("yasad.instanceTheme", "dusk");
    mockApi({
      "GET /api/instance": { status: 500, body: { error: { code: "internal_error", message: "" } } },
      "GET /api/setup": { status: 200, body: { open: false } },
      "GET /api/auth/get-session": { status: 200, body: null },
      ...NO_PUBLIC_LINKS,
    });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("data-theme", "dusk");
  });

  it("switches language and appearance from the signed-out screen", async () => {
    mockApi({ "GET /api/setup": { status: 200, body: { open: false } }, "GET /api/auth/get-session": { status: 200, body: null },
      ...NO_PUBLIC_LINKS });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("radio", { name: "Dark" }));
    expect(document.documentElement).toHaveAttribute("data-mode", "dark");
    expect(localStorage.getItem("yasad.mode")).toBe("dark");
    const preferences = screen.getByRole("group", { name: "Preferences" });
    expect(preferences.compareDocumentPosition(screen.getByRole("main")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.selectOptions(within(preferences).getByLabelText("Language / Langue"), "fr");
    expect(screen.getByRole("heading", { name: "Connexion" })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Préférences" })).getByLabelText("Language / Langue")).toHaveValue("fr");
    expect(localStorage.getItem("yasad.language")).toBe("fr");
  });

  it("shows the account menu and signs out from it", async () => {
    const fetchMock = mockApi({
      "GET /api/setup": { status: 200, body: { open: false } },
      "GET /api/auth/get-session": [
        { status: 200, body: { user: ADA, session: {} } },
        { status: 200, body: null },
      ],
      "GET /api/home": [
        { status: 200, body: { signedIn: true, categories: [], empty: "catalog_empty", pins: [] } },
        { status: 200, body: { signedIn: false, categories: [], empty: null, pins: [] } },
      ],
      "POST /api/auth/sign-out": { status: 200, body: {} },
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Account menu for Ada Lovelace" }));
    const menu = screen.getByRole("menu");
    expect(menu).toHaveTextContent("ada@example.invalid");
    expect(menu).toHaveTextContent("Administrator");
    expect([...menu.querySelectorAll('[role^="menuitem"]')].map((item) => item.textContent)).toEqual(["My links", "My account", "Administration", "Sign out"]);
    await user.click(within(menu).getByRole("menuitem", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([path]) => path === "/api/auth/sign-out")).toBe(true);
  });

  it("asks a user with a temporary password to change it, then shows home", async () => {
    const fetchMock = mockApi({
      "GET /api/setup": { status: 403, body: { error: { code: "password_change_required", message: "" } } },
      "GET /api/auth/get-session": [
        { status: 200, body: { user: { ...ADA, mustChangePassword: true }, session: {} } },
        { status: 200, body: { user: ADA, session: {} } },
      ],
      "GET /api/home": { status: 200, body: { signedIn: true, categories: [], empty: "nothing_visible", pins: [] } },
      "POST /api/account/password": { status: 204 },
    });
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Choose your password" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([path]) => path === "/api/home")).toBe(false);
    const signOut = screen.getByRole("button", { name: "Sign out" });
    expect(signOut.compareDocumentPosition(screen.getByRole("group", { name: "Preferences" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Account menu/ })).toBeNull();
    await user.type(screen.getByLabelText("Temporary password"), "temporary password");
    await user.type(screen.getByLabelText("New password"), "a brand new passphrase");
    await user.type(screen.getByLabelText("Confirm new password"), "a brand new passphrase");
    await user.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByRole("heading", { name: "My links", level: 1 })).toHaveFocus();
    expect(screen.getByRole("note")).toHaveTextContent("Password saved.");
    const call = fetchMock.mock.calls.find(([path]) => path === "/api/account/password")!;
    expect(JSON.parse(String(call[1]!.body))).toEqual({ currentPassword: "temporary password", newPassword: "a brand new passphrase" });
  });

  it("says that password sign-in is off, except on /sign-in/local", async () => {
    const routes = {
      "GET /api/instance": { status: 200, body: { title: "YASAD", logo: null, theme: "default", defaultLanguage: "en", passwordSignIn: false } },
      "GET /api/setup": { status: 200, body: { open: false } },
      "GET /api/auth/get-session": { status: 200, body: null },
      ...NO_PUBLIC_LINKS,
    };
    mockApi(routes);
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Password sign-in is off" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).toBeNull();
    await waitFor(() => expect(document.title).toBe("Password sign-in is off - YASAD"));
    const adminLink = screen.getByRole("link", { name: "Administrator? Sign in with a password" });
    expect(adminLink).toHaveAttribute("href", "/sign-in/local");
    await userEvent.setup().click(adminLink);
    expect(await screen.findByRole("heading", { name: "Administrator sign-in" })).toHaveFocus();
    expect(location.pathname).toBe("/sign-in/local");
    cleanup();

    history.replaceState(null, "", "/sign-in/local");
    mockApi(routes);
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Administrator sign-in" })).toBeInTheDocument();
    expect(screen.getByText("Reserved to administrators.")).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Administrator sign-in - YASAD"));
    history.replaceState(null, "", "/");
  });

  it("says so when the server cannot be reached, in the sign-in layout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Server unreachable" })).toBeInTheDocument();
    expect(screen.getByText(/cannot reach its server/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Server unreachable - YASAD"));
  });

  describe("anonymous visitor", () => {
    const PUBLIC_HOME = { status: 200, body: { signedIn: false, categories: [CATEGORY], empty: null, pins: [] } };
    const anonymous: Routes = {
      "GET /api/setup": { status: 200, body: { open: false } },
      "GET /api/auth/get-session": { status: 200, body: null },
      "GET /api/home": PUBLIC_HOME,
    };

    it("sees the public links with a sign-in link and no section links", async () => {
      const user = userEvent.setup();
      const fetchMock = mockApi(anonymous);
      renderAt("/");
      expect(await screen.findByRole("heading", { name: "Links", level: 1 })).toBeInTheDocument();
      await waitFor(() => expect(document.title).toBe("Links - YASAD"));
      const card = screen.getByRole("link", { name: "Mail" });
      expect(card).toHaveAttribute("href", "https://mail.example.invalid");
      expect(card).not.toHaveAttribute("target");
      expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
      expect(screen.queryByRole("button", { name: /Account menu/ })).toBeNull();
      expect(within(screen.getByRole("contentinfo")).getByLabelText(/Language/)).toBeInTheDocument();
      expect(fetchMock.mock.calls.filter(([path]) => path === "/api/home")).toHaveLength(1);

      await user.click(screen.getByRole("link", { name: "Sign in" }));
      expect(location.pathname).toBe("/sign-in");
      expect(await screen.findByLabelText("Password")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Sign in", level: 1 })).toBeInTheDocument();
    });

    it("sees the sign-in screen on / when no link is public", async () => {
      mockApi({ ...anonymous, "GET /api/home": { status: 200, body: { signedIn: false, categories: [], empty: null, pins: [] } } });
      renderAt("/");
      expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
      expect(screen.getByLabelText("Password")).toBeInTheDocument();
      expect(location.pathname).toBe("/");
    });

    it("sees the sign-in screen when /api/home fails", async () => {
      mockApi({ ...anonymous, "GET /api/home": { status: 500, body: { error: { code: "internal_error", message: "" } } } });
      renderAt("/");
      expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("gets the sign-in form on /sign-in even with public links, then lands on / once signed in", async () => {
      const user = userEvent.setup();
      mockApi({
        ...anonymous,
        "GET /api/auth/get-session": [
          { status: 200, body: null },
          { status: 200, body: { user: BOB, session: {} } },
        ],
        "GET /api/home": [PUBLIC_HOME, { status: 200, body: { signedIn: true, categories: [CATEGORY], empty: null, pins: [] } }],
        "POST /api/auth/sign-in/email": { status: 200, body: {} },
      });
      renderAt("/sign-in");
      expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
      await user.type(screen.getByLabelText("E-mail"), "bob@example.invalid");
      await user.type(screen.getByLabelText("Password"), "a long enough password");
      await user.click(screen.getByRole("button", { name: "Sign in" }));
      expect(await screen.findByRole("heading", { name: "My links", level: 1 })).toBeInTheDocument();
      expect(location.pathname).toBe("/");
      expect(await screen.findByRole("link", { name: "Mail" })).toBeInTheDocument();
    });

    it("gets the setup flow before the public links while setup is open", async () => {
      const fetchMock = mockApi({ ...anonymous, "GET /api/setup": { status: 200, body: { open: true } } });
      renderAt("/");
      expect(await screen.findByRole("heading", { name: "Set up YASAD" })).toBeInTheDocument();
      expect(fetchMock.mock.calls.some(([path]) => path === "/api/home")).toBe(false);
    });

    it("reloads the session when the home answers as signed out", async () => {
      mockApi({
        ...anonymous,
        "GET /api/auth/get-session": [
          { status: 200, body: { user: BOB, session: {} } },
          { status: 200, body: null },
        ],
        "GET /api/home": [{ status: 200, body: { signedIn: false, categories: [], empty: null, pins: [] } }],
      });
      renderAt("/");
      expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    });
  });

  describe("navigation", () => {
    it("gives an admin the sections in the account menu, the current one marked, and no section links in the header", async () => {
      const user = userEvent.setup();
      mockApi(signedIn(ADA));
      renderAt("/");
      await screen.findByRole("heading", { name: "My links", level: 1 });
      expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
      const menu = await openAccountMenu(user, ADA.name);
      expect(within(menu).getByRole("menuitem", { name: "My links" })).toHaveAttribute("aria-current", "page");
      expect(within(menu).getByRole("menuitem", { name: "Administration" })).not.toHaveAttribute("aria-current");
    });

    it("leaves Administration out of a user's account menu", async () => {
      const user = userEvent.setup();
      mockApi(signedIn(BOB));
      renderAt("/");
      await screen.findByRole("heading", { name: "My links", level: 1 });
      const menu = await openAccountMenu(user, BOB.name);
      expect(within(menu).getByRole("menuitem", { name: "My links" })).toHaveAttribute("href", "/");
      expect(within(menu).queryByRole("menuitem", { name: "Administration" })).toBeNull();
    });

    it("moves between pages without reloading the session, then focuses the page heading", async () => {
      const user = userEvent.setup();
      const fetchMock = mockApi(signedIn(ADA));
      renderAt("/");
      expect(await screen.findByRole("heading", { name: "My links", level: 1 })).toBeInTheDocument();
      expect(document.activeElement).toBe(document.body);
      await waitFor(() => expect(document.title).toBe("My links - YASAD"));

      await user.click(within(await openAccountMenu(user, ADA.name)).getByRole("menuitem", { name: "Administration" }));
      const heading = await screen.findByRole("heading", { name: "Dashboard", level: 1 });
      expect(location.pathname).toBe("/admin");
      expect(heading).toHaveFocus();
      await waitFor(() => expect(document.title).toBe("Dashboard - Administration - YASAD"));
      const menu = await openAccountMenu(user, ADA.name);
      expect(within(menu).getByRole("menuitem", { name: "Administration" })).toHaveAttribute("aria-current", "page");
      expect(within(menu).getByRole("menuitem", { name: "My links" })).not.toHaveAttribute("aria-current");
      await user.keyboard("{Escape}");

      await user.click(within(screen.getByRole("navigation", { name: "Administration" })).getByRole("link", { name: "Links" }));
      expect(location.pathname).toBe("/admin/links");
      await waitFor(() => expect(document.title).toBe("Links - Administration - YASAD"));
      expect(screen.getByRole("heading", { name: "Links", level: 1 })).toHaveFocus();

      act(() => {
        history.back();
      });
      await vi.waitFor(() => expect(location.pathname).toBe("/admin"));
      await waitFor(() => expect(document.title).toBe("Dashboard - Administration - YASAD"));

      expect(fetchMock.mock.calls.filter(([path]) => path === "/api/auth/get-session")).toHaveLength(1);
    });

    it("normalizes a trailing slash and the former groups list without adding a history entry", async () => {
      mockApi(signedIn(ADA));
      const length = history.length;
      renderAt("/admin/");
      expect(await screen.findByRole("link", { name: "Dashboard", current: "page" })).toBeInTheDocument();
      expect(location.pathname).toBe("/admin");
      expect(history.length).toBe(length);
      expect(document.activeElement).toBe(document.body);
      cleanup();

      mockApi(signedIn(ADA));
      renderAt("/admin/groups/");
      expect(await screen.findByRole("link", { name: "People", current: "page" })).toBeInTheDocument();
      expect(location.pathname).toBe("/admin/users");
      expect(history.length).toBe(length);
      cleanup();

      mockApi(signedIn(ADA));
      renderAt("/admin/catalog");
      expect(await screen.findByRole("heading", { name: "YAML file", level: 1 })).toBeInTheDocument();
      expect(location.pathname).toBe("/admin/links/file");
      expect(history.length).toBe(length);
    });

    it("shows a translated not-found page with a link home", async () => {
      const user = userEvent.setup();
      mockApi(signedIn(BOB));
      renderAt("/nowhere");
      expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
      await waitFor(() => expect(document.title).toBe("Page not found - YASAD"));
      await user.click(screen.getByRole("link", { name: "Back to my links" }));
      expect(location.pathname).toBe("/");
      expect(await screen.findByRole("heading", { name: "My links", level: 1 })).toHaveFocus();
    });

    it("shows an unknown administration page as not found to an admin", async () => {
      mockApi(signedIn(ADA));
      renderAt("/admin/nowhere");
      expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    });

    it("tells a user that administration pages are for admins only", async () => {
      mockApi(signedIn(BOB));
      renderAt("/admin/catalog");
      expect(await screen.findByRole("heading", { name: "Admins only" })).toBeInTheDocument();
      await waitFor(() => expect(document.title).toBe("Admins only - YASAD"));
      expect(screen.getByRole("link", { name: "Back to my links" })).toHaveAttribute("href", "/");
    });

    it("translates the not-found and forbidden pages", async () => {
      localStorage.setItem("yasad.language", "fr");
      mockApi(signedIn(BOB));
      renderAt("/admin/users");
      expect(await screen.findByRole("heading", { name: "Réservé aux administrateurs" })).toBeInTheDocument();
      act(() => navigate("/nulle-part"));
      expect(await screen.findByRole("heading", { name: "Page introuvable" })).toHaveFocus();
      expect(screen.getByRole("link", { name: "Retour à mes liens" })).toBeInTheDocument();
    });

    it("keeps the password change in front of every page, without the account menu", async () => {
      mockApi({
        ...signedIn({ ...ADA, mustChangePassword: true }),
        "GET /api/setup": { status: 403, body: { error: { code: "password_change_required", message: "" } } },
      });
      renderAt("/admin/users");
      expect(await screen.findByRole("heading", { name: "Choose your password" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Account menu/ })).toBeNull();
      await waitFor(() => expect(document.title).toBe("Choose your password - YASAD"));
    });

    it("titles the setup steps", async () => {
      mockApi({ "GET /api/setup": { status: 200, body: { open: true } }, "GET /api/auth/get-session": { status: 200, body: null },
      ...NO_PUBLIC_LINKS });
      renderAt("/");
      await screen.findByRole("heading", { name: "Set up YASAD" });
      await waitFor(() => expect(document.title).toBe("Setup code - Set up YASAD - YASAD"));
    });

    it("shows the password change when the API says an admin reset the password since the page loaded", async () => {
      const user = userEvent.setup();
      mockApi(signedIn(ADA));
      renderAt("/");
      expect(await screen.findByRole("heading", { name: "My links", level: 1 })).toBeInTheDocument();
      const required = { status: 403, body: { error: { code: "password_change_required", message: "" } } };
      mockApi({
        ...signedIn({ ...ADA, mustChangePassword: true }),
        "GET /api/setup": required,
        "GET /api/admin/users": required,
        "GET /api/admin/groups": required,
      });
      await user.click(within(await openAccountMenu(user, ADA.name)).getByRole("menuitem", { name: "Administration" }));
      expect(await screen.findByRole("heading", { name: "Choose your password" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Account menu/ })).toBeNull();
    });

    it("shows the sign-in screen when the API says the session ended", async () => {
      const user = userEvent.setup();
      mockApi(signedIn(ADA));
      renderAt("/admin/users");
      await screen.findByRole("heading", { name: "People" });
      const unauthenticated = { status: 401, body: { error: { code: "unauthenticated", message: "" } } };
      mockApi({
        "GET /api/setup": { status: 200, body: { open: false } },
        "GET /api/auth/get-session": { status: 200, body: null },
      ...NO_PUBLIC_LINKS,
        "GET /api/admin/users": unauthenticated,
        "GET /api/admin/groups": unauthenticated,
        "GET /api/admin/catalog/state": unauthenticated,
        "GET /api/admin/categories": unauthenticated,
      });
      await user.click(within(screen.getByRole("navigation", { name: "Administration" })).getByRole("link", { name: "Links" }));
      expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    });

    it("tells a demoted admin that administration pages are for admins only", async () => {
      const user = userEvent.setup();
      mockApi(signedIn(ADA));
      renderAt("/admin/users");
      await screen.findByRole("heading", { name: "People" });
      const forbidden = { status: 403, body: { error: { code: "forbidden", message: "" } } };
      mockApi({ ...signedIn({ ...ADA, role: "user" }), "GET /api/admin/users": forbidden, "GET /api/admin/groups": forbidden, "GET /api/admin/catalog/state": forbidden, "GET /api/admin/categories": forbidden });
      await user.click(within(screen.getByRole("navigation", { name: "Administration" })).getByRole("link", { name: "Links" }));
      expect(await screen.findByRole("heading", { name: "Admins only" })).toHaveFocus();
      expect(within(await openAccountMenu(user, ADA.name)).queryByRole("menuitem", { name: "Administration" })).toBeNull();
    });

    it("signs a local admin in from /sign-in/local without showing the password sign-in off screen", async () => {
      const user = userEvent.setup();
      mockApi({
        "GET /api/instance": { status: 200, body: { title: "YASAD", logo: null, theme: "default", defaultLanguage: "en", passwordSignIn: false } },
        "GET /api/setup": { status: 200, body: { open: false } },
        "GET /api/auth/get-session": [
          { status: 200, body: null },
          { status: 200, body: { user: ADA, session: {} } },
        ],
        "GET /api/home": [
          { status: 200, body: { signedIn: false, categories: [], empty: null, pins: [] } },
          { status: 200, body: { signedIn: true, categories: [], empty: "nothing_visible", pins: [] } },
        ],
        "POST /api/auth/sign-in/email": { status: 200, body: {} },
      });
      renderAt("/sign-in/local");
      await screen.findByRole("heading", { name: "Administrator sign-in" });
      const seen: string[] = [];
      const observer = new MutationObserver(() => {
        const heading = document.querySelector("h1")?.textContent;
        if (heading) seen.push(heading);
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      await user.type(screen.getByLabelText("E-mail"), "ada@example.invalid");
      await user.type(screen.getByLabelText("Password"), "a long enough password");
      await user.click(screen.getByRole("button", { name: "Sign in" }));
      expect(await screen.findByRole("heading", { name: "My links", level: 1 })).toBeInTheDocument();
      observer.disconnect();
      expect(seen).not.toContain("Password sign-in is off");
      expect(location.pathname).toBe("/");
    });

    it("sends a signed-in user away from /sign-in/local", async () => {
      mockApi(signedIn(BOB));
      renderAt("/sign-in/local");
      expect(await screen.findByRole("heading", { name: "My links", level: 1 })).toBeInTheDocument();
      expect(location.pathname).toBe("/");
    });
  });

  describe("search", () => {
    const search = () => screen.queryByRole("combobox", { name: "Search links" });

    it.each(["/", "/admin/users", "/nowhere"])("is in the header on %s for a signed-in admin", async (path) => {
      mockApi(signedIn({ ...ADA, id: "ada" }));
      renderAt(path);
      await screen.findByRole("button", { name: "Account menu for Ada Lovelace" });
      expect(search()).toBeInTheDocument();
    });

    it("is on the anonymous home, and not on the sign-in or password screens", async () => {
      mockApi({
        "GET /api/setup": { status: 200, body: { open: false } },
        "GET /api/auth/get-session": { status: 200, body: null },
        "GET /api/home": { status: 200, body: { signedIn: false, categories: [CATEGORY], empty: null, pins: [] } },
      });
      renderAt("/");
      await screen.findByRole("heading", { name: "Links", level: 1 });
      expect(search()).toBeInTheDocument();
      cleanup();

      renderAt("/sign-in");
      await screen.findByRole("heading", { name: "Sign in" });
      expect(search()).toBeNull();
      cleanup();

      mockApi({
        ...signedIn({ ...ADA, id: "ada", mustChangePassword: true }),
        "GET /api/setup": { status: 403, body: { error: { code: "password_change_required", message: "" } } },
      });
      renderAt("/");
      await screen.findByRole("heading", { name: "Choose your password" });
      expect(search()).toBeNull();
    });

    it("never shows the previous person's links after the session changed", async () => {
      const adaHome = { signedIn: true, categories: [{ id: "c", title: "Private", links: [{ ...CATEGORY.links[0]!, id: "vault", title: "Ada vault" }] }], empty: null, pins: [] };
      const bobHome = { signedIn: true, categories: [CATEGORY], empty: null, pins: [] };
      let session: object = { ...ADA, id: "ada" };
      let homeBody: object = adaHome;
      const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (path: string) => {
          if (path === "/api/setup") return answer(200, { open: false });
          if (path === "/api/auth/get-session") return answer(200, { user: session, session: {} });
          if (path === "/api/home") return answer(200, homeBody);
          if (path === "/api/admin/users") return answer(401, { error: { code: "unauthenticated", message: "" } });
          throw new Error(`Unexpected request: ${path}`);
        }),
      );
      const user = userEvent.setup();
      renderAt("/");
      expect(await screen.findByRole("link", { name: "Ada vault" })).toBeInTheDocument();
      await user.type(search()!, "vault");
      expect(await screen.findByRole("option", { name: /^Ada vault/ })).toBeInTheDocument();

      // Ada's session ends on the server and Bob signs in on the same browser.
      session = { ...BOB, id: "bob" };
      homeBody = bobHome;
      act(() => navigate("/admin/users"));
      expect(await screen.findByRole("heading", { name: "Admins only" })).toBeInTheDocument();
      expect(screen.queryByRole("option")).toBeNull();
      await user.type(search()!, "vault");
      expect(screen.queryByRole("option", { name: /Ada vault/ })).toBeNull();
      expect(await screen.findByText("No link matches vault")).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: /Ada vault/ })).toBeNull();
      await user.clear(search()!);
      await user.type(search()!, "mail");
      expect(await screen.findByRole("option", { name: /^Mail/ })).toBeInTheDocument();
    });

    it("never keeps a signed-in answer on the public page, and reloads the session instead", async () => {
      const publicHome = { signedIn: false, categories: [CATEGORY], empty: null, pins: [] };
      const bobHome = { signedIn: true, categories: [{ id: "c", title: "Private", links: [{ ...CATEGORY.links[0]!, id: "vault", title: "Bob vault" }] }], empty: null, pins: [] };
      let session: object | null = null;
      let homeBody: object = publicHome;
      const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (path: string) => {
          if (path === "/api/setup") return answer(200, { open: false });
          if (path === "/api/auth/get-session") return answer(200, session && { user: session, session: {} });
          if (path === "/api/home") return answer(200, homeBody);
          throw new Error(`Unexpected request: ${path}`);
        }),
      );
      const user = userEvent.setup();
      renderAt("/");
      expect(await screen.findByRole("heading", { name: "Links", level: 1 })).toBeInTheDocument();

      // Bob signs in in another tab; this tab still shows the public page.
      session = { ...BOB, id: "bob" };
      homeBody = bobHome;
      await user.click(search()!);
      expect(await screen.findByRole("heading", { name: "My links", level: 1 })).toBeInTheDocument();

      // Bob signs out in the other tab: this tab goes back to the public links, without Bob's.
      session = null;
      homeBody = publicHome;
      await user.click(search()!);
      expect(await screen.findByRole("heading", { name: "Links", level: 1 })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Bob vault" })).toBeNull();
      await user.type(search()!, "vault");
      expect(await screen.findByText("No link matches vault")).toBeInTheDocument();
    });
  });
});

describe("App, views and focus", () => {
  const signedOut: Routes = {
    "GET /api/setup": { status: 200, body: { open: false } },
    "GET /api/auth/get-session": { status: 200, body: null },
    ...NO_PUBLIC_LINKS,
  };

  it("shows the minimal shell while loading, titled and announced only after 300 ms", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => new Promise<Response>(() => {})),
      );
      render(<App />);
      const shell = document.querySelector('[data-slot="loading-shell"]');
      expect(shell).toHaveClass("appear-delayed");
      expect(screen.getByRole("link", { name: "YASAD" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
      expect(screen.queryByRole("contentinfo")).toBeNull();
      expect(screen.queryByRole("combobox", { name: "Search links" })).toBeNull();
      act(() => vi.advanceTimersByTime(299));
      expect(document.querySelector('[data-slot="announcer"]')).toHaveTextContent("");
      act(() => vi.advanceTimersByTime(1));
      expect(document.querySelector('[data-slot="announcer"]')).toHaveTextContent("Loading…");
      expect(document.title).toBe("Loading… - YASAD");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the focus on Try again when the server is still down, then reloads the instance and focuses the heading", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<App />);
    const retry = await screen.findByRole("button", { name: "Try again" });
    await user.click(retry);
    expect(await screen.findByRole("alert")).toHaveTextContent("The server still does not respond.");
    expect(retry).toHaveFocus();
    const firstAlert = screen.getByRole("alert");
    await user.click(retry);
    await waitFor(() => expect(screen.getByRole("alert")).not.toBe(firstAlert));
    expect(retry).toHaveFocus();

    const fetchMock = mockApi({
      ...signedOut,
      "GET /api/instance": { status: 200, body: { title: "Home lab", logo: null, theme: "default", defaultLanguage: "en", passwordSignIn: true } },
    });
    await user.click(retry);
    const heading = await screen.findByRole("heading", { level: 1, name: "Sign in" });
    expect(heading).toHaveFocus();
    expect(fetchMock.mock.calls.some(([path]) => path === "/api/instance")).toBe(true);
    await waitFor(() => expect(document.title).toBe("Sign in - Home lab"));
  });

  it("focuses the page heading after signing in, then after signing out", async () => {
    const user = userEvent.setup();
    mockApi({
      ...signedOut,
      "GET /api/auth/get-session": [
        { status: 200, body: null },
        { status: 200, body: { user: { ...ADA, id: "ada" }, session: {} } },
        { status: 200, body: null },
      ],
      "GET /api/home": [
        { status: 200, body: { signedIn: false, categories: [], empty: null, pins: [] } },
        { status: 200, body: { signedIn: true, categories: [], empty: "nothing_visible", pins: [] } },
        { status: 200, body: { signedIn: false, categories: [], empty: null, pins: [] } },
      ],
      "POST /api/auth/sign-in/email": { status: 200, body: {} },
      "POST /api/auth/sign-out": { status: 200, body: {} },
    });
    renderAt("/");
    await screen.findByRole("heading", { name: "Sign in" });
    expect(document.activeElement).toBe(document.body);
    await user.type(screen.getByLabelText("E-mail"), "ada@example.invalid");
    await user.type(screen.getByLabelText("Password"), "a long enough password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { level: 1, name: "My links" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Account menu for Ada Lovelace" }));
    await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toHaveFocus();
  });

  it("says the session ended on the sign-in screen, then brings the person back to the same page", async () => {
    const user = userEvent.setup();
    mockApi(signedIn({ ...ADA, id: "ada" }));
    renderAt("/admin/users");
    await screen.findByRole("heading", { name: "People" });
    const unauthenticated = { status: 401, body: { error: { code: "unauthenticated", message: "" } } };
    mockApi({
      ...signedOut,
      "GET /api/auth/get-session": [
        { status: 200, body: null },
        { status: 200, body: { user: { ...ADA, id: "ada" }, session: {} } },
      ],
      "GET /api/admin/users": [unauthenticated, { status: 200, body: { users: [] } }],
      "GET /api/admin/groups": [unauthenticated, { status: 200, body: { groups: [] } }],
      "GET /api/admin/catalog/state": [unauthenticated, { status: 200, body: { managedByFile: false, categories: 0, links: 0, groups: 0 } }],
      "GET /api/admin/categories": [unauthenticated, { status: 200, body: { categories: [] } }],
      "POST /api/auth/sign-in/email": { status: 200, body: {} },
    });
    await user.click(within(screen.getByRole("navigation", { name: "Administration" })).getByRole("link", { name: "Links" }));
    const notice = await screen.findByRole("group", { name: "Your session has ended. Sign in again to continue." });
    expect(notice).toHaveFocus();
    expect(location.pathname).toBe("/admin/links");

    await user.type(screen.getByLabelText("E-mail"), "ada@example.invalid");
    await user.type(screen.getByLabelText("Password"), "a long enough password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Links" })).toHaveFocus();
    expect(location.pathname).toBe("/admin/links");
    expect(screen.queryByText("Your session has ended. Sign in again to continue.")).toBeNull();
  });

  it("says the session ended over the public links, with a sign-in link, until the next navigation", async () => {
    const user = userEvent.setup();
    const publicHome = { status: 200, body: { signedIn: false, categories: [CATEGORY], empty: null, pins: [] } };
    mockApi({
      ...signedIn({ ...BOB, id: "bob" }),
      "GET /api/auth/get-session": [
        { status: 200, body: { user: { ...BOB, id: "bob" }, session: {} } },
        { status: 200, body: null },
      ],
      "GET /api/home": [{ status: 200, body: { signedIn: false, categories: [], empty: null, pins: [] } }, publicHome],
    });
    renderAt("/");
    const notice = await screen.findByRole("note");
    expect(notice).toHaveTextContent("Your session has ended. Sign in again to continue.");
    expect(screen.getByRole("heading", { level: 1, name: "Links" })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[data-slot="announcer"]')).toHaveTextContent("Your session has ended."));
    expect(within(notice).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");

    await user.click(within(notice).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Links" })).toHaveFocus();
  });

  it("stops saying the session ended once the notice is gone", async () => {
    const publicHome = { status: 200, body: { signedIn: false, categories: [CATEGORY], empty: null, pins: [] } };
    mockApi({
      ...signedIn({ ...BOB, id: "bob" }),
      "GET /api/auth/get-session": [
        { status: 200, body: { user: { ...BOB, id: "bob" }, session: {} } },
        { status: 200, body: null },
      ],
      "GET /api/home": [{ status: 200, body: { signedIn: false, categories: [], empty: null, pins: [] } }, publicHome],
    });
    renderAt("/");
    await screen.findByRole("note");
    act(() => navigate("/elsewhere"));
    act(() => navigate("/sign-in"));
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByText("Your session has ended. Sign in again to continue.")).toBeNull();
  });

  it("clears the shell notice on the next navigation", async () => {
    const publicHome = { status: 200, body: { signedIn: false, categories: [CATEGORY], empty: null, pins: [] } };
    mockApi({
      ...signedIn({ ...BOB, id: "bob" }),
      "GET /api/auth/get-session": [
        { status: 200, body: { user: { ...BOB, id: "bob" }, session: {} } },
        { status: 200, body: null },
      ],
      "GET /api/home": [{ status: 200, body: { signedIn: false, categories: [], empty: null, pins: [] } }, publicHome],
    });
    renderAt("/");
    await screen.findByRole("note");
    act(() => navigate("/sign-in"));
    act(() => navigate("/"));
    expect(await screen.findByRole("heading", { level: 1, name: "Links" })).toBeInTheDocument();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("sends /sign-in/local to /sign-in when password sign-in is on", async () => {
    mockApi(signedOut);
    renderAt("/sign-in/local");
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    await waitFor(() => expect(location.pathname).toBe("/sign-in"));
  });

  it("focuses the heading of the guided home after setup", async () => {
    const user = userEvent.setup();
    mockApi({
      "GET /api/setup": [{ status: 200, body: { open: true } }, { status: 200, body: { open: false } }],
      "GET /api/auth/get-session": [{ status: 200, body: null }, { status: 200, body: { user: { ...ADA, id: "ada" }, session: {} } }],
      "GET /api/home": { status: 200, body: { signedIn: true, categories: [], empty: "catalog_empty", pins: [] } },
      "POST /api/setup/verify-code": { status: 204 },
      "POST /api/setup": { status: 201, body: { user: ADA } },
    });
    renderAt("/");
    await user.type(await screen.findByLabelText("Setup code"), "a-setup-code-that-is-long-enough");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(screen.getByLabelText("Name"), ADA.name);
    await user.type(screen.getByLabelText("E-mail"), ADA.email);
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.type(screen.getByLabelText("Confirm password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Create administrator" }));
    expect(await screen.findByRole("heading", { level: 1, name: "YASAD is ready" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Go to YASAD" }));
    expect(await screen.findByRole("heading", { level: 1, name: "My links" })).toHaveFocus();
  });

  it("focuses the heading when an admin tab is opened while the list is still loading", async () => {
    const user = userEvent.setup();
    mockApi(signedIn(ADA));
    renderAt("/admin/users");
    await screen.findByRole("heading", { name: "People" });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    await user.click(within(screen.getByRole("navigation", { name: "Administration" })).getByRole("link", { name: "Links" }));
    expect(screen.getByRole("heading", { level: 1, name: "Links" })).toHaveFocus();
  });
});

describe("App, temporary password and account", () => {
  const required = { status: 403, body: { error: { code: "password_change_required", message: "" } } };

  it("replaces the temporary password in the sign-in layout, then opens the asked page with a notice", async () => {
    const user = userEvent.setup();
    mockApi({
      ...signedIn({ ...ADA, id: "ada" }),
      "GET /api/setup": [required, { status: 200, body: { open: false } }],
      "GET /api/auth/get-session": [
        { status: 200, body: { user: { ...ADA, id: "ada", mustChangePassword: true }, session: {} } },
        { status: 200, body: { user: { ...ADA, id: "ada" }, session: {} } },
      ],
      "POST /api/account/password": { status: 204 },
    });
    renderAt("/admin/users");
    expect(await screen.findByRole("heading", { level: 1, name: "Choose your password" })).toBeInTheDocument();
    expect(screen.queryByRole("banner")?.querySelector("nav")).toBeFalsy();
    expect(screen.getByText("Signed in as Ada Lovelace (ada@example.invalid).")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Temporary password"), "temporary password");
    await user.type(screen.getByLabelText("New password"), "a brand new passphrase");
    await user.type(screen.getByLabelText("Confirm new password"), "a brand new passphrase");
    await user.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByRole("heading", { level: 1, name: "People" })).toHaveFocus();
    expect(location.pathname).toBe("/admin/users");
    expect(screen.getByRole("note")).toHaveTextContent("Password saved.");
    await waitFor(() => expect(document.querySelector('[data-slot="announcer"]')).toHaveTextContent("Password saved."));

    await user.click(within(screen.getByRole("navigation", { name: "Administration" })).getByRole("link", { name: "Links" }));
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("signs out from the temporary password step", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      ...signedIn({ ...ADA, id: "ada" }),
      ...NO_PUBLIC_LINKS,
      "GET /api/setup": [required, { status: 200, body: { open: false } }],
      "GET /api/auth/get-session": [
        { status: 200, body: { user: { ...ADA, id: "ada", mustChangePassword: true }, session: {} } },
        { status: 200, body: null },
      ],
      "POST /api/auth/sign-out": { status: 200, body: {} },
    });
    renderAt("/");
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toHaveFocus();
    expect(fetchMock.mock.calls.some(([path]) => path === "/api/auth/sign-out")).toBe(true);
  });

  it("opens the account page from the menu, marked as the current page", async () => {
    const user = userEvent.setup();
    mockApi({ ...signedIn({ ...ADA, id: "ada" }), "GET /api/account": { status: 200, body: { origin: "local" } } });
    renderAt("/");
    await screen.findByRole("heading", { level: 1, name: "My links" });
    await user.click(screen.getByRole("button", { name: "Account menu for Ada Lovelace" }));
    await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "My account" }));
    expect(location.pathname).toBe("/account");
    expect(await screen.findByRole("heading", { level: 1, name: "Ada Lovelace" })).toHaveFocus();
    await waitFor(() => expect(document.title).toBe("My account - YASAD"));
    const menu = await openAccountMenu(user, ADA.name);
    expect(within(menu).getByRole("menuitem", { name: "My account" })).toHaveAttribute("aria-current", "page");
    expect(within(menu).getAllByRole("menuitem").filter((item) => item.getAttribute("aria-current") === "page")).toHaveLength(1);
  });

  it("shows the saved name everywhere once the profile is changed", async () => {
    const user = userEvent.setup();
    mockApi({
      ...signedIn({ ...ADA, id: "ada" }),
      "GET /api/auth/get-session": [
        { status: 200, body: { user: { ...ADA, id: "ada" }, session: {} } },
        { status: 200, body: { user: { ...ADA, id: "ada", name: "Augusta Ada King" }, session: {} } },
      ],
      "GET /api/account": { status: 200, body: { origin: "local" } },
      "PATCH /api/account": { status: 200, body: { user: { id: "ada", name: "Augusta Ada King", email: ADA.email } } },
    });
    renderAt("/account");
    await user.click(await screen.findByRole("button", { name: "Edit: Name" }));
    const name = screen.getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "Augusta Ada King");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByRole("button", { name: "Account menu for Augusta Ada King" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit: Name" })).toHaveFocus());
    expect(screen.getByRole("heading", { level: 1, name: "Augusta Ada King" })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="account-status"]')).toHaveTextContent("Profile saved.");
  });
});

describe("App, OIDC sign-in", () => {
  const AUTHORIZE = "https://idp.example.invalid/authorize";
  const END_SESSION = "https://idp.example.invalid/logout?id_token_hint=abc";
  const instance = (passwordSignIn: boolean) => ({
    "GET /api/instance": { status: 200, body: { title: "YASAD", logo: null, theme: "default", defaultLanguage: "en", passwordSignIn, oidc: { name: "Okta" } } },
  });
  const anonymous = (passwordSignIn = false): Routes => ({
    ...instance(passwordSignIn),
    "GET /api/setup": { status: 200, body: { open: false } },
    "GET /api/auth/get-session": { status: 200, body: null },
    ...NO_PUBLIC_LINKS,
    "POST /api/auth/sign-in/social": { status: 200, body: { url: AUTHORIZE } },
  });
  /** Return the requests sent to start the provider sign-in. */
  const starts = (fetchMock: ReturnType<typeof mockApi>) => fetchMock.mock.calls.filter(([path]) => path === "/api/auth/sign-in/social");

  let assign: ReturnType<typeof vi.spyOn>;
  let replace: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    assign = vi.spyOn(leavePage, "assign").mockImplementation(() => {});
    replace = vi.spyOn(leavePage, "replace").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("goes to the provider at once on a deep link when password sign-in is off, coming back to it", async () => {
    const fetchMock = mockApi(anonymous());
    renderAt("/admin/links");
    expect(await screen.findByText("Redirecting to Okta…")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Administrator? Sign in with a password" })).toBeInTheDocument();
    await waitFor(() => expect(replace).toHaveBeenCalledWith(AUTHORIZE));
    const call = starts(fetchMock)[0]!;
    expect(JSON.parse(String(call[1]!.body))).toEqual({ returnTo: "/admin/links" });
    expect(starts(fetchMock)).toHaveLength(1);
  });

  it("goes to the provider at once after the server comes back on page load", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderAt("/");
    const retry = await screen.findByRole("button", { name: "Try again" });
    const fetchMock = mockApi(anonymous());
    await userEvent.setup().click(retry);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(AUTHORIZE));
    expect(starts(fetchMock)).toHaveLength(1);
  });

  it("does not go to the provider by itself when password sign-in is on", async () => {
    const fetchMock = mockApi(anonymous(true));
    renderAt("/");
    expect(await screen.findByRole("button", { name: "Sign in with Okta" })).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(starts(fetchMock)).toHaveLength(0);
  });

  it("does not go to the provider by itself on /sign-in/local", async () => {
    const fetchMock = mockApi(anonymous());
    renderAt("/sign-in/local");
    expect(await screen.findByRole("heading", { name: "Administrator sign-in" })).toBeInTheDocument();
    expect(starts(fetchMock)).toHaveLength(0);
  });

  it("does not go to the provider by itself on /signed-out", async () => {
    const fetchMock = mockApi(anonymous());
    renderAt("/signed-out");
    expect(await screen.findByRole("heading", { level: 1, name: "You are signed out" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with Okta" })).toBeInTheDocument();
    expect(starts(fetchMock)).toHaveLength(0);
  });

  it("sends a signed-in person from /signed-out to the home page", async () => {
    mockApi({ ...signedIn(ADA), ...instance(false) });
    renderAt("/signed-out");
    expect(await screen.findByRole("heading", { name: "My links", level: 1 })).toBeInTheDocument();
    expect(location.pathname).toBe("/");
  });

  it("shows the error of the address focused, removes it from the address and does not go to the provider", async () => {
    const fetchMock = mockApi(anonymous());
    renderAt("/sign-in?error=access_denied");
    expect(await screen.findByRole("group", { name: "Your account does not have access to this portal." })).toHaveFocus();
    expect(location.pathname).toBe("/sign-in");
    expect(location.search).toBe("");
    expect(screen.getByRole("button", { name: "Sign in with Okta" })).toBeInTheDocument();
    expect(starts(fetchMock)).toHaveLength(0);
  });

  it("offers Try again after an unknown error, and starts only when asked", async () => {
    const fetchMock = mockApi(anonymous());
    renderAt("/sign-in?error=state_mismatch");
    expect(await screen.findByRole("group", { name: "Sign-in failed. Try again." })).toHaveFocus();
    expect(starts(fetchMock)).toHaveLength(0);
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(AUTHORIZE));
    expect(replace).not.toHaveBeenCalled();
  });

  it("offers the provider on the setup screen without going there", async () => {
    const fetchMock = mockApi({ ...anonymous(), "GET /api/setup": { status: 200, body: { open: true } } });
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "Set up YASAD" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Sign in with Okta" })).toBeInTheDocument();
    expect(starts(fetchMock)).toHaveLength(0);
  });

  it("does not go to the provider when the session ends in an open tab, only on the next navigation", async () => {
    const user = userEvent.setup();
    mockApi({ ...signedIn({ ...ADA, id: "ada" }), ...instance(false) });
    renderAt("/admin/users");
    await screen.findByRole("heading", { name: "People" });
    const unauthenticated = { status: 401, body: { error: { code: "unauthenticated", message: "" } } };
    const fetchMock = mockApi({
      ...anonymous(),
      "GET /api/admin/users": unauthenticated,
      "GET /api/admin/groups": unauthenticated,
      "GET /api/admin/catalog/state": unauthenticated,
      "GET /api/admin/categories": unauthenticated,
    });
    await user.click(within(screen.getByRole("navigation", { name: "Administration" })).getByRole("link", { name: "Links" }));
    expect(await screen.findByRole("group", { name: "Your session has ended. Sign in again to continue." })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Sign in with Okta" })).toBeInTheDocument();
    expect(starts(fetchMock)).toHaveLength(0);

    act(() => navigate("/admin/users"));
    await waitFor(() => expect(replace).toHaveBeenCalledWith(AUTHORIZE));
    expect(starts(fetchMock)).toHaveLength(1);
  });

  it("leaves for the provider's sign-out when the server gives its address", async () => {
    const user = userEvent.setup();
    mockApi({ ...signedIn(ADA), ...instance(false), "POST /api/auth/sign-out": { status: 200, body: { success: true, url: END_SESSION } } });
    renderAt("/");
    await user.click(await screen.findByRole("button", { name: "Account menu for Ada Lovelace" }));
    await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(END_SESSION));
  });

  it("lands on /signed-out after a sign-out without the provider's address, and stays there", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      ...anonymous(),
      ...signedIn(ADA),
      "GET /api/auth/get-session": [
        { status: 200, body: { user: ADA, session: {} } },
        { status: 200, body: null },
      ],
      "GET /api/home": [
        { status: 200, body: { signedIn: true, categories: [], empty: "catalog_empty", pins: [] } },
        { status: 200, body: { signedIn: false, categories: [], empty: null, pins: [] } },
      ],
      "POST /api/auth/sign-out": { status: 200, body: { success: true } },
    });
    renderAt("/admin/users");
    await user.click(await screen.findByRole("button", { name: "Account menu for Ada Lovelace" }));
    await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { level: 1, name: "You are signed out" })).toBeInTheDocument();
    expect(location.pathname).toBe("/signed-out");
    expect(starts(fetchMock)).toHaveLength(0);
    expect(assign).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("keeps today's screen after a failed sign-out, without going to the provider", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      ...anonymous(),
      ...signedIn(ADA),
      "GET /api/auth/get-session": [
        { status: 200, body: { user: ADA, session: {} } },
        { status: 200, body: null },
      ],
      "GET /api/home": [
        { status: 200, body: { signedIn: true, categories: [], empty: "catalog_empty", pins: [] } },
        { status: 200, body: { signedIn: false, categories: [], empty: null, pins: [] } },
      ],
      "POST /api/auth/sign-out": { status: 500, body: { error: { code: "internal_error", message: "" } } },
    });
    renderAt("/admin/users");
    await user.click(await screen.findByRole("button", { name: "Account menu for Ada Lovelace" }));
    await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Sign out" }));
    expect(await screen.findByRole("button", { name: "Sign in with Okta" })).toBeInTheDocument();
    expect(location.pathname).toBe("/admin/users");
    expect(starts(fetchMock)).toHaveLength(0);
    expect(replace).not.toHaveBeenCalled();
  });
});
