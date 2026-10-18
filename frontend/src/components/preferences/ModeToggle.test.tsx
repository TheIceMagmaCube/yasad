import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test-utils";
import { ModeToggle } from "./ModeToggle";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("ModeToggle", () => {
  it("offers the three modes as named radio buttons in a group, the current one checked", () => {
    localStorage.setItem("yasad.mode", "light");
    renderWithProviders(<ModeToggle />);
    const group = screen.getByRole("group", { name: "Appearance" });
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => group.contains(r))).toEqual([true, true, true]);
    expect(radios.map((r) => r.getAttribute("value"))).toEqual(["system", "light", "dark"]);
    expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Dark" })).not.toBeChecked();
  });

  it("marks the chosen option with the selected ring on the page colour, and with system colours in forced colors", () => {
    const { container } = renderWithProviders(<ModeToggle />);
    expect(screen.getByRole("group", { name: "Appearance" })).toHaveClass("bg-background");
    const faces = container.querySelectorAll("label > span[aria-hidden]");
    expect(faces).toHaveLength(3);
    for (const face of faces) {
      expect([...face.classList].some((c) => c.startsWith("peer-checked:shadow-") && c.includes("var(--selected)"))).toBe(true);
      expect(face).toHaveClass(
        "forced-colors:peer-checked:bg-[color:Highlight]",
        "forced-colors:peer-checked:text-[color:HighlightText]",
        "forced-colors:peer-focus-visible:outline-[color:CanvasText]",
      );
    }
  });

  it("applies and stores the mode as soon as it is chosen, by click or with the arrow keys", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ModeToggle />);
    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.dataset.mode).toBe("dark");
    expect(localStorage.getItem("yasad.mode")).toBe("dark");

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Light" })).toHaveFocus();
    expect(document.documentElement.dataset.mode).toBe("light");
    expect(localStorage.getItem("yasad.mode")).toBe("light");
  });
});
