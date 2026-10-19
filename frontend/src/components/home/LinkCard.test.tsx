import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { categoryTone } from "@/lib/category-tone";
import { renderWithProviders } from "@/test-utils";

import { LinkCard } from "./LinkCard";

afterEach(cleanup);

const TONE = categoryTone(2);
const LINK = { id: "jira", title: "Jira", description: "Tickets and sprints", url: "https://jira.example.invalid/board", icon: null, keywords: [] };

describe("LinkCard", () => {
  it("is one same-tab link named by the title and described by the description", () => {
    renderWithProviders(<LinkCard link={LINK} tone={TONE} />);
    const card = screen.getByRole("link", { name: "Jira" });
    expect(card).toHaveAttribute("href", "https://jira.example.invalid/board");
    expect(card).not.toHaveAttribute("target");
    expect(card).toHaveAccessibleDescription("Tickets and sprints");
    // Only the title is the anchor, so the name is exactly the text it shows; its ::after covers the card.
    expect(card).toHaveTextContent(/^Jira$/);
    expect(card).toHaveClass("after:absolute", "after:inset-0");
    expect(card.parentElement?.parentElement).toHaveClass("relative", "has-[a:focus-visible]:outline-2", "has-[a:focus-visible]:outline-ring");
  });

  it("has no description reference without a description", () => {
    renderWithProviders(<LinkCard link={{ ...LINK, description: "" }} tone={TONE} />);
    expect(screen.getByRole("link", { name: "Jira" })).not.toHaveAttribute("aria-describedby");
  });

  it("hides the icon tile from assistive technology and colours it with the category", () => {
    const { container } = renderWithProviders(<LinkCard link={LINK} tone={TONE} />);
    const tile = container.querySelector('[data-slot="link-icon"]');
    expect(tile).toHaveAttribute("aria-hidden", "true");
    expect(tile).toHaveClass(...TONE.tile.split(" "));
    expect(tile).toHaveTextContent("J");
  });

  it("is a raised card on a base of the category colour, with a boundary kept in forced colors", () => {
    renderWithProviders(<LinkCard link={LINK} tone={TONE} />);
    const card = screen.getByRole("link", { name: "Jira" }).parentElement?.parentElement;
    expect(card).toHaveClass("relief", TONE.card);
    // Forced colors drop the relief shadows; the .relief outline drawn instead would vanish under outline-none.
    expect(card).not.toHaveClass("outline-none");
  });

  it("wraps long titles and descriptions instead of truncating them", () => {
    const long = "x".repeat(60);
    renderWithProviders(<LinkCard link={{ ...LINK, title: long, description: long }} tone={TONE} />);
    const card = screen.getByRole("link", { name: long }).parentElement!.parentElement!;
    expect(card.querySelectorAll(".wrap-anywhere")).toHaveLength(2);
    expect(card.querySelector(".truncate")).toBeNull();
  });
});
