import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithProviders } from "../test-utils";
import { AppShell } from "./AppShell";

afterEach(cleanup);

describe("AppShell", () => {
  it("gives an anonymous visitor a sign-in link and the preferences in the footer, without menu or section links", () => {
    renderWithProviders(
      <AppShell user={null} path="/">
        <p>content</p>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("button", { name: /Account menu/ })).toBeNull();
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByLabelText(/Language/)).toBeInTheDocument();
    expect(within(footer).getByRole("group", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByRole("search", { name: "Search links" })).toBeInTheDocument();
  });

  it("gives a signed-in person the menu and no footer", () => {
    renderWithProviders(
      <AppShell user={{ id: "ada", name: "Ada", email: "ada@example.invalid", role: "user" }} path="/" onSignOut={() => {}}>
        <p>content</p>
      </AppShell>,
    );
    expect(screen.getByRole("button", { name: "Account menu for Ada" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(screen.queryByRole("contentinfo")).toBeNull();
    expect(within(screen.getByRole("banner")).getByRole("combobox", { name: "Search links" })).toBeInTheDocument();
  });

  it("puts the toggle before the field and the field before the account menu in focus order", () => {
    renderWithProviders(
      <AppShell user={{ id: "ada", name: "Ada", email: "ada@example.invalid", role: "user" }} path="/" onSignOut={() => {}}>
        <p>content</p>
      </AppShell>,
    );
    const banner = screen.getByRole("banner");
    const order = [...banner.querySelectorAll("a, button, input")].map((el) => el.getAttribute("aria-label") ?? el.textContent);
    expect(order.slice(-3)).toEqual(["Search", "Search links", "Account menu for Ada"]);
  });

  it("keeps the brand alone in minimal mode without a user (loading)", () => {
    renderWithProviders(
      <AppShell user={null} path="/" minimal>
        <p>content</p>
      </AppShell>,
    );
    const banner = screen.getByRole("banner");
    expect(within(banner).getAllByRole("link").map((a) => a.textContent)).toEqual(["YASAD"]);
    expect(within(banner).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("search")).toBeNull();
    expect(screen.queryByRole("contentinfo")).toBeNull();
  });
});
