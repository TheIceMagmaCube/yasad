import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { navigate } from "./lib/router";
import { mockApi, type Routes } from "./test-utils";

const ADA = { name: "Ada Lovelace", email: "ada@example.invalid", role: "admin" };
const BOB = { name: "Bob", email: "bob@example.invalid", role: "user" };

/** Return the API answers for a signed-in person, admin lists included. */
function signedIn(user: object): Routes {
  return {
    "GET /api/setup": { status: 200, body: { open: false } },
    "GET /api/auth/get-session": { status: 200, body: { user, session: {} } },
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
    mockApi({ "GET /api/setup": { status: 200, body: { open: true } }, "GET /api/auth/get-session": { status: 200, body: null } });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Set up YASAD" })).toBeInTheDocument();
  });

  it("shows the sign-in screen once setup is closed", async () => {
    mockApi({ "GET /api/setup": { status: 200, body: { open: false } }, "GET /api/auth/get-session": { status: 200, body: null } });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("shows the home page to a signed-in user", async () => {
    mockApi({
      "GET /api/setup": { status: 200, body: { open: false, setupCodeStillSet: false } },
      "GET /api/auth/get-session": { status: 200, body: { user: ADA, session: {} } },
    });
    render(<App />);
    expect(await screen.findByText("Signed in as Ada Lovelace.")).toBeInTheDocument();
  });

  it("applies the instance title, theme and language, and caches them", async () => {
    vi.stubGlobal("navigator", { ...navigator, languages: ["de-DE"] });
    mockApi({
      "GET /api/instance": { status: 200, body: { title: "Home lab", logo: null, theme: "dusk", defaultLanguage: "fr", passwordSignIn: true } },
      "GET /api/setup": { status: 200, body: { open: false } },
      "GET /api/auth/get-session": { status: 200, body: null },
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
    });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("data-theme", "dusk");
  });

  it("switches language and appearance from the signed-out screen", async () => {
    mockApi({ "GET /api/setup": { status: 200, body: { open: false } }, "GET /api/auth/get-session": { status: 200, body: null } });
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
      "POST /api/account/password": { status: 204 },
    });
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Choose your password" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Current password"), "temporary password");
    await user.type(screen.getByLabelText("New password"), "a brand new passphrase");
    await user.type(screen.getByLabelText("Confirm new password"), "a brand new passphrase");
    await user.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByRole("heading", { name: "Welcome" })).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([path]) => path === "/api/account/password")!;
    expect(JSON.parse(String(call[1]!.body))).toEqual({ currentPassword: "temporary password", newPassword: "a brand new passphrase" });
  });

  it("says that password sign-in is off, except on /sign-in/local", async () => {
    const routes = {
      "GET /api/instance": { status: 200, body: { title: "YASAD", logo: null, theme: "default", defaultLanguage: "en", passwordSignIn: false } },
      "GET /api/setup": { status: 200, body: { open: false } },
      "GET /api/auth/get-session": { status: 200, body: null },
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

  describe("navigation", () => {
    it("shows the section links to an admin, marks the current one and keeps Administration out of the account menu", async () => {
      const user = userEvent.setup();
      mockApi(signedIn(ADA));
      renderAt("/");
      const nav = await screen.findByRole("navigation", { name: "Main" });
      expect(within(nav).getByRole("link", { name: "My links" })).toHaveAttribute("aria-current", "page");
      expect(within(nav).getByRole("link", { name: "Administration" })).not.toHaveAttribute("aria-current");
      await user.click(screen.getByRole("button", { name: "Account menu for Ada Lovelace" }));
      expect(within(screen.getByRole("menu")).queryByRole("menuitem", { name: "Administration" })).toBeNull();
    });

    it("hides the Administration link from a user", async () => {
      mockApi(signedIn(BOB));
      renderAt("/");
      const nav = await screen.findByRole("navigation", { name: "Main" });
      expect(within(nav).getByRole("link", { name: "My links" })).toBeInTheDocument();
      expect(within(nav).queryByRole("link", { name: "Administration" })).toBeNull();
    });

    it("moves between pages without reloading the session, then focuses the page heading", async () => {
      const user = userEvent.setup();
      const fetchMock = mockApi(signedIn(ADA));
      renderAt("/");
      expect(await screen.findByRole("heading", { name: "Welcome" })).toBeInTheDocument();
      expect(document.activeElement).toBe(document.body);
      expect(document.title).toBe("My links - YASAD");

      await user.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Administration" }));
      const heading = await screen.findByRole("heading", { name: "Administration", level: 1 });
      expect(location.pathname).toBe("/admin/users");
      expect(heading).toHaveFocus();
      expect(document.title).toBe("Users - Administration - YASAD");
      expect(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Administration" })).toHaveAttribute(
        "aria-current",
        "page",
      );

      await user.click(within(screen.getByRole("navigation", { name: "Administration" })).getByRole("link", { name: "Groups" }));
      expect(location.pathname).toBe("/admin/groups");
      expect(document.title).toBe("Groups - Administration - YASAD");
      expect(screen.getByRole("heading", { name: "Administration", level: 1 })).toHaveFocus();

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
      expect(await screen.findByRole("heading", { name: "Welcome" })).toHaveFocus();
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
      mockApi({ "GET /api/setup": { status: 200, body: { open: true } }, "GET /api/auth/get-session": { status: 200, body: null } });
      renderAt("/");
      await screen.findByRole("heading", { name: "Set up YASAD" });
      expect(document.title).toBe("Setup code - Set up YASAD - YASAD");
    });

    it("sends a signed-in user away from /sign-in/local", async () => {
      mockApi(signedIn(BOB));
      renderAt("/sign-in/local");
      expect(await screen.findByRole("heading", { name: "Welcome" })).toBeInTheDocument();
      expect(location.pathname).toBe("/");
    });
  });
});
