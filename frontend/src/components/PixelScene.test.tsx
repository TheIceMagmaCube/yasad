import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PixelScene } from "./PixelScene";

afterEach(cleanup);

describe("PixelScene", () => {
  it("is decoration only, left out in forced colors", () => {
    const { container } = render(<PixelScene />);
    const scene = container.firstElementChild!;
    expect(scene).toHaveAttribute("aria-hidden", "true");
    expect(scene).toHaveClass("forced-colors:hidden");
    for (const svg of scene.querySelectorAll("svg")) expect(svg).toHaveAttribute("focusable", "false");
  });

  it("follows the mode by default, and keeps the dusk scene alone on request", () => {
    const auto = render(<PixelScene />).container.querySelectorAll("svg");
    expect([...auto].map((svg) => svg.getAttribute("class"))).toEqual([
      expect.stringContaining("dark:hidden"),
      expect.stringContaining("dark:block"),
    ]);
    cleanup();
    const dusk = render(<PixelScene time="dusk" />).container.querySelectorAll("svg");
    expect(dusk).toHaveLength(1);
    expect(dusk[0]).not.toHaveClass("dark:block");
  });
});
