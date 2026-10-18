import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthHero } from "./AuthHero";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const LINES = ["First line", "Second line", "Third line"];

describe("AuthHero", () => {
  it("renders the title as the focusable h1, then one of the lines", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    render(<AuthHero title="Sign in" lines={LINES} />);
    const heading = screen.getByRole("heading", { level: 1, name: "Sign in" });
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(screen.getByText("Second line")).toBeInTheDocument();
    expect(screen.queryByText("First line")).toBeNull();
  });

  it("keeps the line it drew when it renders again", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const { rerender } = render(<AuthHero title="Sign in" lines={LINES} />);
    random.mockReturnValue(0.9);
    rerender(<AuthHero title="Sign in" lines={LINES} />);
    expect(screen.getByText("First line")).toBeInTheDocument();
  });

  it("follows a language change with the same line from the new list", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { rerender } = render(<AuthHero title="Sign in" lines={LINES} />);
    rerender(<AuthHero title="Connexion" lines={["Première ligne", "Deuxième ligne", "Troisième ligne"]} />);
    expect(screen.getByText("Deuxième ligne")).toBeInTheDocument();
    expect(screen.queryByText("Second line")).toBeNull();
  });

  it("hides the drawing from assistive technologies and from forced colors", () => {
    const { container } = render(<AuthHero title="Sign in" lines={LINES} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveClass("forced-colors:hidden");
  });

  it("draws the desk awake, or asleep with its snores shown still under reduced motion", () => {
    const { container, rerender } = render(<AuthHero title="Sign in" lines={LINES} />);
    expect(container.querySelector("svg")).toHaveAttribute("data-state", "awake");
    expect(container.querySelector(".motion-reduce\\:opacity-100")).toBeNull();
    rerender(<AuthHero title="Signed out" lines={LINES} asleep />);
    expect(container.querySelector("svg")).toHaveAttribute("data-state", "asleep");
    expect(container.querySelectorAll(".motion-reduce\\:opacity-100")).toHaveLength(3);
  });

  it.each([false, true])("animates only under motion-safe, on parts the reduced-motion guard covers (asleep: %s)", (asleep) => {
    const { container } = render(<AuthHero title="Sign in" lines={LINES} asleep={asleep} />);
    const animated = [...container.querySelectorAll("[class*='animate-']")];
    expect(animated.length).toBeGreaterThan(0);
    for (const element of animated) {
      const classes = [...element.classList];
      expect(classes.filter((c) => c.includes("animate-")).every((c) => c.startsWith("motion-safe:animate-["))).toBe(true);
      expect(classes).toContain("pixel-part");
    }
  });
});
