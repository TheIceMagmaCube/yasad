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
    expect(footer.querySelector(".pixel-band")).toHaveAttribute("aria-hidden", "true");
    expect(within(footer).getByLabelText(/Language/)).toBeInTheDocument();
    expect(within(footer).getByRole("group", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByRole("search", { name: "Search links" })).toBeInTheDocument();
  });

  it("gives a signed-in person the menu, no section links in the header and no footer", () => {
    renderWithProviders(
      <AppShell user={{ id: "ada", name: "Ada", email: "ada@example.invalid", role: "admin" }} path="/" onSignOut={() => {}}>
        <p>content</p>
      </AppShell>,
    );
    expect(screen.getByRole("button", { name: "Account menu for Ada" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
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
    expect(document.querySelector("a, button, input")).toHaveTextContent("Skip to content");
  });

  it("keeps the header opaque, so its text contrast does not depend on what scrolls under it", () => {
    renderWithProviders(
      <AppShell user={null} path="/">
        <p>content</p>
      </AppShell>,
    );
    const header = screen.getByRole("banner");
    expect(header).toHaveClass("bg-header", "border-header-border");
    expect(header.className).not.toMatch(/bg-header\/|backdrop-/);
  });

  it("keeps the account menu in the first header row, never folded away by the width", () => {
    renderWithProviders(
      <AppShell user={{ id: "ada", name: "Ada", email: "ada@example.invalid", role: "admin" }} path="/" onSignOut={() => {}}>
        <p>content</p>
      </AppShell>,
    );
    const slot = screen.getByRole("button", { name: "Account menu for Ada" }).parentElement!;
    expect(slot).toHaveClass("row-start-1");
    for (let el: HTMLElement | null = slot; el; el = el.parentElement) expect(el.className).not.toMatch(/(^|\s)(hidden|sm:block|sr-only)(\s|$)/);
  });

  it("aligns the header, the content and the footer on one centred column", () => {
    renderWithProviders(
      <AppShell user={null} path="/">
        <p>content</p>
      </AppShell>,
    );
    for (const role of ["banner", "main"] as const) expect(screen.getByRole(role)).toHaveClass("mx-auto", "max-w-7xl");
    expect(screen.getByRole("contentinfo").querySelector(".max-w-7xl")).toHaveClass("mx-auto");
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
