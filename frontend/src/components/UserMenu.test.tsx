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
    const avatar = trigger.querySelector("[data-initials]");
    expect(avatar).toHaveAttribute("data-initials", "AL");
    expect(avatar).toHaveClass("pixel-corners", "bg-primary", "text-primary-foreground");
    // The initials must not be DOM text, or they are visible text missing from the label.
    expect(trigger).not.toHaveTextContent("AL");
    expect(trigger.querySelectorAll("svg[aria-hidden=true]")).toHaveLength(1);
  });

  it("takes the initials of the first and last word, as the account page does", () => {
    renderWithProviders(<UserMenu user={{ ...ADA, name: "Augusta Ada King" }} path="/" onSignOut={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Account menu for Augusta Ada King" });
    expect(trigger.querySelector("[data-initials]")).toHaveAttribute("data-initials", "AK");
  });

  it("lists who is signed in, the pages and sign-out, each entry with an icon", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu user={ADA} path="/" onSignOut={vi.fn()} />);
    const menu = await openMenu(user);
    expect(menu).toHaveTextContent("Ada Lovelace");
    expect(menu).toHaveTextContent("ada@example.invalid");
    expect(menu).toHaveTextContent("Administrator");
    expect(items(menu)).toEqual(["My links", "My account", "Administration", "About", "Sign out"]);
    for (const item of menu.querySelectorAll('[role="menuitem"]')) expect(item.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1);
    expect(within(menu).getByRole("menuitem", { name: "My links" })).toHaveAttribute("href", "/");
    expect(within(menu).getByRole("menuitem", { name: "My account" })).toHaveAttribute("href", "/account");
    expect(within(menu).getByRole("menuitem", { name: "My account" })).not.toHaveAttribute("aria-current");
    expect(within(menu).getByRole("menuitem", { name: "Administration" })).toHaveAttribute("href", "/admin");
    expect(within(menu).getByRole("menuitem", { name: "About" })).toHaveAttribute("href", "/about");
  });

  it.each(["user", "admin"])("sets the about page apart for a %s, between two separators", async (role) => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu user={{ ...ADA, role }} path="/" onSignOut={vi.fn()} />);
    const menu = await openMenu(user);
    const about = within(menu).getByRole("menuitem", { name: "About" });
    expect(about).toHaveAttribute("href", "/about");
    expect(about).not.toHaveAttribute("aria-current");
    expect(about.previousElementSibling).toHaveAttribute("role", "separator");
    expect(about.nextElementSibling).toHaveAttribute("role", "separator");
  });

  it("leaves language and appearance to the account page", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu user={ADA} path="/" onSignOut={vi.fn()} />);
    const menu = await openMenu(user);
    expect(within(menu).queryAllByRole("menuitemradio")).toEqual([]);
    expect(within(menu).queryByRole("group")).toBeNull();
    for (const text of ["Language", "Appearance", "English", "Français", "System", "Light", "Dark"]) expect(menu).not.toHaveTextContent(text);
  });

  it("leaves administration and the role out for a user, and marks the account page when it is open", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu user={{ ...ADA, role: "user" }} path="/account" onSignOut={vi.fn()} />);
    const menu = await openMenu(user);
    expect(items(menu)).toEqual(["My links", "My account", "About", "Sign out"]);
    expect(menu).not.toHaveTextContent("Administrator");
    expect(within(menu).getByRole("menuitem", { name: "My account" })).toHaveAttribute("aria-current", "page");
  });

  it.each([
    ["/", "My links"],
    ["/account", "My account"],
    ["/admin/groups", "Administration"],
    ["/admin", "Administration"],
    ["/about", "About"],
  ])("marks the entry of %s with more than colour", async (path, current) => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu user={ADA} path={path} onSignOut={vi.fn()} />);
    const menu = await openMenu(user);
    for (const name of ["My links", "My account", "Administration", "About"]) {
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

  it("marks the about page for a user", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu user={{ ...ADA, role: "user" }} path="/about" onSignOut={vi.fn()} />);
    const menu = await openMenu(user);
    expect(within(menu).getByRole("menuitem", { name: "About" })).toHaveAttribute("aria-current", "page");
    expect(within(menu).getAllByRole("menuitem").filter((item) => item.getAttribute("aria-current") === "page")).toHaveLength(1);
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

  it("cuts a long name and e-mail to one line each, the whole text kept in their title", async () => {
    const user = userEvent.setup();
    const email = `${"a".repeat(80)}@example.invalid`;
    renderWithProviders(<UserMenu user={{ ...ADA, email }} path="/" onSignOut={vi.fn()} />);
    const menu = await openMenu(user);
    expect(within(menu).getByText(email)).toHaveClass("truncate");
    expect(within(menu).getByText(email)).toHaveAttribute("title", email);
    expect(within(menu).getByText("Ada Lovelace")).toHaveAttribute("title", "Ada Lovelace");
  });

  it("signs out from its last entry", async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    renderWithProviders(<UserMenu user={ADA} path="/" onSignOut={onSignOut} />);
    await user.click(within(await openMenu(user)).getByRole("menuitem", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
