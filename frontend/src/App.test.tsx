import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { mockApi } from "./test-utils";

const ADA = { name: "Ada Lovelace", email: "ada@example.org", role: "admin" };

afterEach(() => {
  cleanup();
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
      "GET /api/instance": { status: 200, body: { title: "Home lab", logo: null, theme: "dusk", defaultLanguage: "fr" } },
      "GET /api/setup": { status: 200, body: { open: false } },
      "GET /api/auth/get-session": { status: 200, body: null },
    });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Connexion" })).toBeInTheDocument();
    expect(document.title).toBe("Home lab");
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
    expect(menu).toHaveTextContent("ada@example.org");
    expect(menu).toHaveTextContent("Administrator");
    await user.click(within(menu).getByRole("menuitem", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([path]) => path === "/api/auth/sign-out")).toBe(true);
  });

  it("says so when the server cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("cannot reach its server");
  });
});
