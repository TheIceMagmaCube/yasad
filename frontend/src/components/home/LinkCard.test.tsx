import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { categoryTone } from "@/lib/category-tone";
import { renderWithProviders } from "@/test-utils";

import { type CardPin, LinkCard } from "./LinkCard";

afterEach(cleanup);

const TONE = categoryTone(2);
/** The card of a link without description, as it rendered before the manage mode existed. */
const PLAIN_CARD =
  `<div class="relief relative flex h-full items-start gap-3 rounded-(--radius-card) bg-card p-4 text-card-foreground [--relief-ring:var(--border)] has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-4 has-[a:focus-visible]:outline-ring [--relief-color:var(--category-3-fill)]"><span aria-hidden="true" data-slot="link-icon" class="pixel-corners flex size-11 shrink-0 items-center justify-center bg-category-3-fill text-on-fill"><span data-initial="J" class="text-pixel text-2xl leading-none before:content-[attr(data-initial)]"></span></span><span class="min-w-0 flex-1"><a href="https://jira.example.invalid/board" class="block font-heading font-bold wrap-anywhere outline-none after:absolute after:inset-0 after:rounded-(--radius-card) after:content-['']">Jira</a></span></div>`;

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
    expect(tile?.querySelector("[data-initial]")).toHaveAttribute("data-initial", "J");
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

  describe("pin button of the manage mode", () => {
    const pin = (over: Partial<CardPin> = {}): CardPin => ({ pinned: false, pending: false, onToggle: vi.fn(), id: "pin-card-jira", ...over });

    it("has no pin button outside the manage mode", () => {
      renderWithProviders(<LinkCard link={LINK} tone={TONE} />);
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("renders unchanged without pin", () => {
      const { container } = renderWithProviders(<LinkCard link={{ ...LINK, description: "" }} tone={TONE} />);
      expect(container.firstElementChild!.outerHTML).toBe(PLAIN_CARD);
    });

    it("names the button from its visible text, without aria-pressed", () => {
      const { rerender } = renderWithProviders(<LinkCard link={{ ...LINK, title: "Status page" }} tone={TONE} pin={pin()} />);
      const button = screen.getByRole("button", { name: "Pin Status page" });
      expect(button).toHaveTextContent(/^Pin$/);
      expect(button).toHaveAttribute("id", "pin-card-jira");
      expect(button).not.toHaveAttribute("aria-pressed");
      expect(button).toHaveClass("min-h-11");
      expect(button.closest("div.relative.z-10")).not.toBeNull();

      rerender(<LinkCard link={{ ...LINK, title: "Status page" }} tone={TONE} pin={pin({ pinned: true })} />);
      const pinned = screen.getByRole("button", { name: "Pinned: remove Status page from favourites" });
      expect(pinned).toHaveTextContent(/^Pinned$/);
      expect(pinned).not.toHaveAttribute("aria-pressed");
      expect(pinned.getAttribute("aria-label")!.startsWith(pinned.textContent!)).toBe(true);
      expect(pinned.querySelector("svg")).toHaveClass("fill-current");
      // The link stays the card's one anchor, named by its title only.
      expect(screen.getByRole("link", { name: "Status page" })).toBeInTheDocument();
    });

    it("keeps the focus on the button after a click", async () => {
      const user = userEvent.setup();
      const onToggle = vi.fn();
      renderWithProviders(<LinkCard link={LINK} tone={TONE} pin={pin({ onToggle })} />);
      const button = screen.getByRole("button", { name: "Pin Jira" });
      await user.click(button);
      expect(onToggle).toHaveBeenCalledTimes(1);
      expect(button).toHaveFocus();
    });

    it("stays focusable and ignores clicks while pending, with its text kept", async () => {
      const user = userEvent.setup();
      const onToggle = vi.fn();
      renderWithProviders(<LinkCard link={LINK} tone={TONE} pin={pin({ onToggle, pending: true })} />);
      const button = screen.getByRole("button", { name: "Pin Jira" });
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).not.toBeDisabled();
      await user.click(button);
      expect(onToggle).not.toHaveBeenCalled();
      expect(button).toHaveTextContent(/^Pin$/);
    });
  });
});
