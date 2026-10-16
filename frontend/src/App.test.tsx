import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { navigate } from "./lib/router";
import { mockApi, type Routes } from "./test-utils";

const ADA = { name: "Ada Lovelace", email: "ada@example.invalid", role: "admin" };
const BOB = { name: "Bob", email: "bob@example.invalid", role: "user" };
const CATEGORY = {
  id: "everyday",
  title: "Everyday",
  links: [{ id: "mail", title: "Mail", description: "Company mailbox", url: "https://mail.example.invalid", icon: null }],
};

/** Home answer of an anonymous visitor on an instance with no public link. */
const NO_PUBLIC_LINKS: Routes = { "GET /api/home": { status: 200, body: { signedIn: false, categories: [], empty: null } } };

/** Return the API answers for a signed-in person, admin lists included. */
function signedIn(user: object): Routes {
  return {
    "GET /api/setup": { status: 200, body: { open: false } },
    "GET /api/auth/get-session": { status: 200, body: { user, session: {} } },
    "GET /api/home": { status: 200, body: { signedIn: true, categories: [], empty: "nothing_visible" } },
    "GET /api/admin/users": { status: 200, body: { users: [] } },
    "GET /api/admin/groups": { status: 200, body: { groups: [] } },
  };
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
      "GET /api/home": { status: 200, body: { signedIn: true, categories: [CATEGORY], empty: null } },
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
    expect(document.title).toBe("Connexion - Home lab");
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
    await user.selectOptions(await screen.findByLabelText("Appearance"), "dark");
    expect(document.documentElement).toHaveAttribute("data-mode", "dark");
    expect(localStorage.getItem("yasad.mode")).toBe("dark");
    await user.selectOptions(screen.getByLabelText("Language"), "fr");
    expect(screen.getByRole("heading", { name: "Connexion" })).toBeInTheDocument();
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
        { status: 200, body: { signedIn: true, categories: [], empty: "catalog_empty" } },
        { status: 200, body: { signedIn: false, categories: [], empty: null } },
      ],
      "POST /api/auth/sign-out": { status: 200, body: {} },
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Account menu for Ada Lovelace" }));
    const menu = screen.getByRole("menu");
    expect(menu).toHaveTextContent("ada@example.invalid");
    expect(menu).toHaveTextContent("Administrator");
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
      "GET /api/home": { status: 200, body: { signedIn: true, categories: [], empty: "nothing_visible" } },
      "POST /api/account/password": { status: 204 },
    });
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Choose your password" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([path]) => path === "/api/home")).toBe(false);
    await user.type(screen.getByLabelText("Current password"), "temporary password");
    await user.type(screen.getByLabelText("New password"), "a brand new passphrase");
    await user.type(screen.getByLabelText("Confirm new password"), "a brand new passphrase");
    await user.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByRole("heading", { name: "My links", level: 1 })).toBeInTheDocument();
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
    cleanup();

    history.replaceState(null, "", "/sign-in/local");
    mockApi(routes);
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByText(/reserved to administrators/)).toBeInTheDocument();
    history.replaceState(null, "", "/");
  });

  it("says so when the server cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("cannot reach its server");
  });

  describe("anonymous visitor", () => {
    const PUBLIC_HOME = { status: 200, body: { signedIn: false, categories: [CATEGORY], empty: null } };
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
      expect(document.title).toBe("Links - YASAD");
      const card = screen.getByRole("link", { name: "Mail" });
      expect(card).toHaveAttribute("href", "https://mail.example.invalid");
      expect(card).not.toHaveAttribute("target");
      expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
      expect(screen.queryByRole("button", { name: /Account menu/ })).toBeNull();
      expect(within(screen.getByRole("contentinfo")).getByLabelText("Language")).toBeInTheDocument();
      expect(fetchMock.mock.calls.filter(([path]) => path === "/api/home")).toHaveLength(1);

      await user.click(screen.getByRole("link", { name: "Sign in" }));
      expect(location.pathname).toBe("/sign-in");
      expect(await screen.findByLabelText("Password")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Sign in", level: 1 })).toBeInTheDocument();
    });

    it("sees the sign-in screen on / when no link is public", async () => {
      mockApi({ ...anonymous, "GET /api/home": { status: 200, body: { signedIn: false, categories: [], empty: null } } });
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
        "GET /api/home": [PUBLIC_HOME, { status: 200, body: { signedIn: true, categories: [CATEGORY], empty: null } }],
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
        "GET /api/home": [{ status: 200, body: { signedIn: false, categories: [], empty: null } }],
      });
      renderAt("/");
      expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    });
  });

  describe("navigation", () => {
    it("shows the section links to an admin, marks the current one and keeps Administration out of the account menu", async () => {
      const user = userEvent.setup();
      mockApi(signedIn(ADA));
      renderAt("/");
      const nav = await screen.findByRole("navigation", { name: "Main" });
      expect(within(nav).getByRole("link", { name: "My links" })).toHaveAttribute("aria-current", "page");
      expect(within(nav).getByRole("link", { name: "Admin" })).not.toHaveAttribute("aria-current");
      await user.click(screen.getByRole("button", { name: "Account menu for Ada Lovelace" }));
      expect(within(screen.getByRole("menu")).queryByRole("menuitem", { name: "Admin" })).toBeNull();
    });

    it("hides the Admin link from a user", async () => {
      mockApi(signedIn(BOB));
      renderAt("/");
      const nav = await screen.findByRole("navigation", { name: "Main" });
      expect(within(nav).getByRole("link", { name: "My links" })).toBeInTheDocument();
      expect(within(nav).queryByRole("link", { name: "Admin" })).toBeNull();
    });

    it("moves between pages without reloading the session, then focuses the page heading", async () => {
      const user = userEvent.setup();
      const fetchMock = mockApi(signedIn(ADA));
      renderAt("/");
      expect(await screen.findByRole("heading", { name: "My links", level: 1 })).toBeInTheDocument();
      expect(document.activeElement).toBe(document.body);
      expect(document.title).toBe("My links - YASAD");

      await user.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Admin" }));
      const heading = await screen.findByRole("heading", { name: "Administration, Users", level: 1 });
      expect(location.pathname).toBe("/admin/users");
      expect(heading).toHaveFocus();
      expect(document.title).toBe("Users - Administration - YASAD");
      expect(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Admin" })).toHaveAttribute(
        "aria-current",
        "page",
      );

      await user.click(within(screen.getByRole("navigation", { name: "Administration" })).getByRole("link", { name: "Groups" }));
      expect(location.pathname).toBe("/admin/groups");
      expect(document.title).toBe("Groups - Administration - YASAD");
      expect(screen.getByRole("heading", { name: "Administration, Groups", level: 1 })).toHaveFocus();

      act(() => {
        history.back();
      });
      await vi.waitFor(() => expect(location.pathname).toBe("/admin/users"));
      expect(document.title).toBe("Users - Administration - YASAD");

      expect(fetchMock.mock.calls.filter(([path]) => path === "/api/auth/get-session")).toHaveLength(1);
    });

    it("normalizes a trailing slash and the bare /admin path without adding a history entry", async () => {
      mockApi(signedIn(ADA));
      const length = history.length;
      renderAt("/admin/");
      expect(await screen.findByRole("link", { name: "Users", current: "page" })).toBeInTheDocument();
      expect(location.pathname).toBe("/admin/users");
      expect(history.length).toBe(length);
      expect(document.activeElement).toBe(document.body);
      cleanup();

      mockApi(signedIn(ADA));
      renderAt("/admin/groups/");
      expect(await screen.findByRole("link", { name: "Groups", current: "page" })).toBeInTheDocument();
      expect(location.pathname).toBe("/admin/groups");
    });

    it("shows a translated not-found page with a link home", async () => {
      const user = userEvent.setup();
      mockApi(signedIn(BOB));
      renderAt("/nowhere");
      expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
      expect(document.title).toBe("Page not found - YASAD");
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
      expect(document.title).toBe("Admins only - YASAD");
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

    it("keeps the password change in front of every page and hides the section links", async () => {
      mockApi({
        ...signedIn({ ...ADA, mustChangePassword: true }),
        "GET /api/setup": { status: 403, body: { error: { code: "password_change_required", message: "" } } },
      });
      renderAt("/admin/users");
      expect(await screen.findByRole("heading", { name: "Choose your password" })).toBeInTheDocument();
      expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
      expect(document.title).toBe("Choose your password - YASAD");
    });

    it("titles the setup steps", async () => {
      mockApi({ "GET /api/setup": { status: 200, body: { open: true } }, "GET /api/auth/get-session": { status: 200, body: null },
      ...NO_PUBLIC_LINKS });
      renderAt("/");
      await screen.findByRole("heading", { name: "Set up YASAD" });
      expect(document.title).toBe("Setup code - Set up YASAD - YASAD");
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
      await user.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Admin" }));
      expect(await screen.findByRole("heading", { name: "Choose your password" })).toBeInTheDocument();
      expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
    });

    it("shows the sign-in screen when the API says the session ended", async () => {
      const user = userEvent.setup();
      mockApi(signedIn(ADA));
      renderAt("/admin/users");
      await screen.findByRole("heading", { name: "Administration, Users" });
      const unauthenticated = { status: 401, body: { error: { code: "unauthenticated", message: "" } } };
      mockApi({
        "GET /api/setup": { status: 200, body: { open: false } },
        "GET /api/auth/get-session": { status: 200, body: null },
      ...NO_PUBLIC_LINKS,
        "GET /api/admin/users": unauthenticated,
        "GET /api/admin/groups": unauthenticated,
      });
      await user.click(within(screen.getByRole("navigation", { name: "Administration" })).getByRole("link", { name: "Groups" }));
      expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    });

    it("tells a demoted admin that administration pages are for admins only", async () => {
      const user = userEvent.setup();
      mockApi(signedIn(ADA));
      renderAt("/admin/users");
      await screen.findByRole("heading", { name: "Administration, Users" });
      const forbidden = { status: 403, body: { error: { code: "forbidden", message: "" } } };
      mockApi({ ...signedIn({ ...ADA, role: "user" }), "GET /api/admin/users": forbidden, "GET /api/admin/groups": forbidden });
      await user.click(within(screen.getByRole("navigation", { name: "Administration" })).getByRole("link", { name: "Groups" }));
      expect(await screen.findByRole("heading", { name: "Admins only" })).toBeInTheDocument();
      expect(within(screen.getByRole("navigation", { name: "Main" })).queryByRole("link", { name: "Admin" })).toBeNull();
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
          { status: 200, body: { signedIn: false, categories: [], empty: null } },
          { status: 200, body: { signedIn: true, categories: [], empty: "nothing_visible" } },
        ],
        "POST /api/auth/sign-in/email": { status: 200, body: {} },
      });
      renderAt("/sign-in/local");
      await screen.findByRole("heading", { name: "Sign in" });
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
});
