import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { hashIndex, PersonTile } from "./shared";

afterEach(cleanup);

describe("PersonTile", () => {
  const fill = (el: Element) => [...el.classList].find((c) => /^bg-category-\d-fill$/.test(c));

  it("gives a person the same colour on every render, from their id", () => {
    const { container, rerender } = render(<PersonTile id="u-42" name="Ada" language="en" />);
    const tile = container.querySelector('[data-slot="person-tile"]')!;
    expect(tile).toHaveAttribute("aria-hidden", "true");
    expect(tile).toHaveTextContent("A");
    const first = fill(tile);
    expect(first).toBe(`bg-category-${(hashIndex("u-42") % 6) + 1}-fill`);
    rerender(<PersonTile id="u-42" name="Ada Byron" language="en" />);
    expect(fill(container.querySelector('[data-slot="person-tile"]')!)).toBe(first);
  });

  // The font class must survive cn(): tailwind-merge drops text-pixel in favour of the tile's text colour.
  it("draws the initials in the pixel font, on a colour and on the disabled grey alike", () => {
    const { container, rerender } = render(<PersonTile id="u-42" name="Ada" language="en" className="size-8 text-sm" />);
    const tile = () => container.querySelector('[data-slot="person-tile"]')!;
    expect(tile()).toHaveClass("font-pixel", "text-on-fill");
    rerender(<PersonTile id="u-42" name="Ada" language="en" disabled className="size-8 text-sm" />);
    expect(tile()).toHaveClass("font-pixel", "text-foreground");
  });

  it("spreads ids over the six colours", () => {
    const seen = new Set(Array.from({ length: 60 }, (_, i) => hashIndex(`user-${i}`) % 6));
    expect(seen.size).toBe(6);
  });

  it("strikes a disabled account through on a grey without its colour", () => {
    const { container } = render(<PersonTile id="u-42" name="Ada" language="en" disabled />);
    const tile = container.querySelector('[data-slot="person-tile"]')!;
    expect(tile).toHaveAttribute("data-disabled");
    expect(tile).toHaveClass("line-through");
    expect(fill(tile)).toBeUndefined();
  });
});
