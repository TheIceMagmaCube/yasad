import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithProviders } from "@/test-utils";

import { LinkCard } from "./LinkCard";

afterEach(cleanup);

const LINK = { id: "jira", title: "Jira", description: "Tickets and sprints", url: "https://jira.example.invalid/board", icon: null, keywords: [] };

describe("LinkCard", () => {
  it("is one same-tab link named by the title and described by the description", () => {
    renderWithProviders(<LinkCard link={LINK} tile="bg-category-1/12 text-category-1" />);
    const card = screen.getByRole("link", { name: "Jira" });
    expect(card).toHaveAttribute("href", "https://jira.example.invalid/board");
    expect(card).not.toHaveAttribute("target");
    expect(card).toHaveAccessibleDescription("Tickets and sprints");
    expect(card).toHaveClass("focus-visible:outline-2", "focus-visible:outline-ring");
    expect(card.className).not.toMatch(/outline-none/);
  });

  it("has no description reference without a description", () => {
    renderWithProviders(<LinkCard link={{ ...LINK, description: "" }} tile="" />);
    expect(screen.getByRole("link", { name: "Jira" })).not.toHaveAttribute("aria-describedby");
  });

  it("hides the icon tile from assistive technology and colours it with the category", () => {
    const { container } = renderWithProviders(<LinkCard link={LINK} tile="bg-category-3/12 text-category-3" />);
    const tile = container.querySelector('[data-slot="link-icon"]');
    expect(tile).toHaveAttribute("aria-hidden", "true");
    expect(tile).toHaveClass("text-category-3");
    expect(tile).toHaveTextContent("J");
  });

  it("wraps long titles and descriptions instead of truncating them", () => {
    const long = "x".repeat(60);
    renderWithProviders(<LinkCard link={{ ...LINK, title: long, description: long }} tile="" />);
    const card = screen.getByRole("link", { name: long });
    expect(card.querySelectorAll(".wrap-anywhere")).toHaveLength(2);
    expect(card.querySelector(".truncate")).toBeNull();
  });
});
