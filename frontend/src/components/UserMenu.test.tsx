import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../test-utils";
import { UserMenu } from "./UserMenu";

const ADA = { id: "ada", name: "Ada Lovelace", email: "ada@example.invalid", role: "admin" };

afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
});

/** Open the menu and return it. */
async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Account menu for Ada Lovelace" }));
  return screen.getByRole("menu");
}

const items = (menu: HTMLElement) => [...menu.querySelectorAll('[role^="menuitem"]')].map((item) => item.textContent);

describe("UserMenu", () => {
  it("shows a filled avatar with the initials and a chevron, the name hidden from the accessible name", () => {
    renderWithProviders(<UserMenu user={ADA} path="/" onSignOut={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Account menu for Ada Lovelace" });
    expect(within(trigger).getByText("AL")).toHaveClass("pixel-corners", "bg-primary", "text-primary-foreground");
    expect(trigger.querySelectorAll("svg[aria-hidden=true]")).toHaveLength(1);
  });

  it("lists the identity, the sections, the account page, the shortcuts and sign-out, without a role line", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu user={ADA} path="/" onSignOut={vi.fn()} />);
    const menu = await openMenu(user);
    expect(menu).toHaveTextContent("Ada Lovelace");
    expect(menu).toHaveTextContent("ada@example.invalid");
    expect(menu).not.toHaveTextContent("Administrator");
    expect(items(menu)).toEqual(["My links", "My account", "Administration", "English", "Français", "System", "Light", "Dark", "Sign out"]);
    expect(within(menu).getByRole("menuitem", { name: "My links" })).toHaveAttribute("href", "/");
    expect(within(menu).getByRole("menuitem", { name: "My account" })).toHaveAttribute("href", "/account");
    expect(within(menu).getByRole("menuitem", { name: "My account" })).not.toHaveAttribute("aria-current");
    expect(within(menu).getByRole("menuitem", { name: "Administration" })).toHaveAttribute("href", "/admin/users");
  });

  it("leaves administration out for a user, and marks the account page when it is open", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu user={{ ...ADA, role: "user" }} path="/account" onSignOut={vi.fn()} />);
    const menu = await openMenu(user);
    expect(items(menu)).not.toContain("Administration");
    expect(within(menu).getByRole("menuitem", { name: "My account" })).toHaveAttribute("aria-current", "page");
  });

  it.each([
    ["/", "My links"],
    ["/account", "My account"],
    ["/admin/groups", "Administration"],
    ["/admin", "Administration"],
  ])("marks the entry of %s with more than colour", async (path, current) => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu user={ADA} path={path} onSignOut={vi.fn()} />);
    const menu = await openMenu(user);
    for (const name of ["My links", "My account", "Administration"]) {
      const item = within(menu).getByRole("menuitem", { name });
      if (name === current) {
        expect(item).toHaveAttribute("aria-current", "page");
        expect(item.querySelector('[data-slot="current-mark"]')).not.toBeNull();
        expect(item).toHaveClass("aria-[current=page]:font-semibold");
      } else {
        expect(item).not.toHaveAttribute("aria-current");
        expect(item.querySelector('[data-slot="current-mark"]')).toBeNull();
      }
    }
  });

  it("lets the menu scroll when it is taller than the room left", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu user={ADA} path="/" onSignOut={vi.fn()} />);
    expect(await openMenu(user)).toHaveClass("overflow-y-auto");
  });

  it("opens the account page with the keyboard", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu user={ADA} path="/" onSignOut={vi.fn()} />);
    screen.getByRole("button", { name: "Account menu for Ada Lovelace" }).focus();
    await user.keyboard("{Enter}");
    expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: "My links" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: "My account" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(location.pathname).toBe("/account");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("wraps a long name and e-mail", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu user={{ ...ADA, email: `${"a".repeat(80)}@example.invalid` }} path="/" onSignOut={vi.fn()} />);
    const menu = await openMenu(user);
    expect(within(menu).getByText(`${"a".repeat(80)}@example.invalid`)).toHaveClass("wrap-anywhere");
  });
});
