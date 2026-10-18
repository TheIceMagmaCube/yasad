import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { categoryTone } from "@/lib/category-tone";
import { renderWithProviders } from "@/test-utils";

import { CategorySection } from "./CategorySection";

afterEach(cleanup);

const CATEGORY = {
  id: "dev",
  title: "Developer tools",
  links: [
    { id: "jira", title: "Jira", description: "", url: "https://jira.example.invalid", icon: null, keywords: [] },
    { id: "wiki", title: "Wiki", description: "", url: "https://wiki.example.invalid", icon: null, keywords: [] },
    { id: "ci", title: "CI", description: "", url: "https://ci.example.invalid", icon: null, keywords: [] },
  ],
};

describe("CategorySection", () => {
  it("is a region named by its h2 with the links in order", () => {
    renderWithProviders(<CategorySection category={CATEGORY} index={0} />);
    const region = screen.getByRole("region", { name: "Developer tools" });
    expect(within(region).getByRole("heading", { level: 2, name: "Developer tools" })).toBeInTheDocument();
    const items = within(within(region).getByRole("list")).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["JJira", "WWiki", "CCI"]);
    expect(within(region).getByRole("list")).toHaveClass("grid-cols-1", "sm:grid-cols-2", "lg:grid-cols-3");
  });

  it("colours the marker, tiles and card bases from the index, cycling after six", () => {
    const { container } = renderWithProviders(<CategorySection category={CATEGORY} index={7} />);
    // Read from categoryTone so a change of palette classes leaves this test alone.
    const tone = categoryTone(1);
    const selector = (classes: string) => classes.split(" ").map((c) => `.${CSS.escape(c)}`).join("");
    expect(container.querySelector(`h2 .size-4${selector(tone.bar)}`)).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelectorAll(`[data-slot="link-icon"]${selector(tone.tile)}`)).toHaveLength(3);
    expect(container.querySelectorAll(`a${selector(tone.card)}`)).toHaveLength(3);
  });
});
