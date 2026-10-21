import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { AccountGroup, AccountInfo } from "../../api";
import { renderWithProviders } from "../../test-utils";
import { GroupsSection, type GroupsState } from "./GroupsSection";

const SYSTEM: AccountGroup[] = [
  { name: "authenticated", source: "system" },
  { name: "everyone", source: "system" },
];

/** Return a ready state for an account of `origin` holding the built-in groups plus `groups`. */
function ready(origin: AccountInfo["origin"], groups: AccountGroup[], providerGroupsAt: string | null = null): GroupsState {
  return { status: "ready", account: { origin, groups: [...SYSTEM, ...groups], providerGroupsAt } };
}

const region = () => screen.getByRole("region", { name: /^(My groups|Mes groupes)$/ });

afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
});

describe("GroupsSection", () => {
  it("lists the built-in groups with what they are for, then the local groups", () => {
    renderWithProviders(<GroupsSection state={ready("local", [{ name: "Contractors", source: "local" }])} />);
    const section = region();
    expect(within(section).getByRole("heading", { level: 3, name: "Built-in groups" })).toBeInTheDocument();
    const terms = within(section).getAllByRole("term").map((el) => el.textContent);
    expect(terms).toEqual(["@authenticated", "@everyone"]);
    const definitions = within(section).getAllByRole("definition").map((el) => el.textContent);
    expect(definitions).toEqual([
      "Anyone signed in holds it. Used for links meant for everyone signed in.",
      "Everyone holds it, even without signing in. Used for public links.",
    ]);
    const local = within(section).getByRole("list", { name: "Local groups (1)" });
    expect(within(local).getAllByRole("listitem").map((el) => el.textContent)).toEqual(["Contractors"]);
    expect(within(section).queryByRole("heading", { name: /Identity provider groups/ })).not.toBeInTheDocument();
  });

  it("lists the provider groups with when they were received", () => {
    const at = "2026-10-20T08:30:00.000Z";
    renderWithProviders(
      <GroupsSection
        state={ready(
          "oidc",
          [
            { name: "portal-users", source: "oidc" },
            { name: "admins", source: "oidc" },
          ],
          at,
        )}
      />,
    );
    const section = region();
    const list = within(section).getByRole("list", { name: "Identity provider groups (2)" });
    expect(within(list).getAllByRole("listitem").map((el) => el.textContent)).toEqual(["admins", "portal-users"]);
    const time = section.querySelector("time")!;
    expect(time).toHaveAttribute("datetime", at);
    expect(time.textContent).toBe(new Intl.DateTimeFormat("en", { dateStyle: "long", timeStyle: "short" }).format(new Date(at)));
    expect(time.parentElement).toHaveTextContent(/^Received when you signed in on .+\. They are read again at your next sign-in\.$/);
    expect(within(section).getByText("No local group.")).toBeInTheDocument();
  });

  it("says when the date of the provider groups is unknown and none were received", () => {
    renderWithProviders(<GroupsSection state={ready("oidc", [])} />);
    const section = region();
    expect(within(section).getByText("Received at your last sign-in. They are read again at your next sign-in.")).toBeInTheDocument();
    expect(within(section).getByText("No group received at your last sign-in.")).toBeInTheDocument();
    expect(section.querySelector("time")).toBeNull();
  });

  it("shows the provider part to a local account holding a provider group", () => {
    renderWithProviders(<GroupsSection state={ready("local", [{ name: "forged", source: "oidc" }])} />);
    const list = within(region()).getByRole("list", { name: "Identity provider groups (1)" });
    expect(within(list).getByText("forged")).toBeInTheDocument();
  });

  it("prefixes only built-in names and keeps the case of the others", () => {
    renderWithProviders(
      <GroupsSection
        state={ready("local", [
          { name: "Dev", source: "local" },
          { name: "dev", source: "local" },
          { name: "everyone", source: "local" },
        ])}
      />,
    );
    const local = within(region()).getByRole("list", { name: "Local groups (3)" });
    const names = within(local).getAllByRole("listitem").map((el) => el.textContent);
    expect(names).toHaveLength(3);
    expect(names).toEqual(expect.arrayContaining(["Dev", "dev", "everyone"]));
  });

  it("translates its texts and sorts names in the language", () => {
    localStorage.setItem("yasad.language", "fr");
    renderWithProviders(
      <GroupsSection
        state={ready("local", [
          { name: "Alice", source: "local" },
          { name: "Zoé", source: "local" },
          { name: "Éric", source: "local" },
        ])}
      />,
    );
    const section = screen.getByRole("region", { name: "Mes groupes" });
    expect(within(section).getByRole("heading", { level: 3, name: "Groupes intégrés" })).toBeInTheDocument();
    const local = within(section).getByRole("list", { name: "Groupes locaux (3)" });
    expect(within(local).getAllByRole("listitem").map((el) => el.textContent)).toEqual(["Alice", "Éric", "Zoé"]);
  });

  it("is busy while loading and shows a plain text on error", () => {
    const { rerender } = renderWithProviders(<GroupsSection state={{ status: "loading" }} />);
    expect(region()).toHaveAttribute("aria-busy", "true");
    expect(within(region()).queryByRole("list")).not.toBeInTheDocument();

    rerender(<GroupsSection state={{ status: "error" }} />);
    const section = region();
    expect(section).not.toHaveAttribute("aria-busy");
    expect(within(section).getByText("Your groups could not be loaded. Use Try again in the Password row.")).toBeInTheDocument();
    expect(within(section).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(section).queryByRole("button")).not.toBeInTheDocument();
  });

  it("focuses its heading once loaded when the address ends in #groups", () => {
    history.replaceState(null, "", "/account#groups");
    const { rerender } = renderWithProviders(<GroupsSection state={{ status: "loading" }} />);
    expect(screen.getByRole("heading", { level: 2, name: "My groups" })).not.toHaveFocus();
    rerender(<GroupsSection state={ready("local", [])} />);
    expect(screen.getByRole("heading", { level: 2, name: "My groups" })).toHaveFocus();
  });

  it("leaves the focus alone without #groups", () => {
    const { rerender } = renderWithProviders(<GroupsSection state={{ status: "loading" }} />);
    rerender(<GroupsSection state={ready("local", [])} />);
    expect(screen.getByRole("heading", { level: 2, name: "My groups" })).not.toHaveFocus();
  });

  it("lets a long name without spaces wrap anywhere", () => {
    const long = "g".repeat(120);
    renderWithProviders(<GroupsSection state={ready("local", [{ name: long, source: "local" }])} />);
    expect(screen.getByText(long).closest("li")).toHaveClass("wrap-anywhere");
  });
});
