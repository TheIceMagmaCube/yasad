import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { Checkbox, CheckboxField } from "./checkbox";

afterEach(cleanup);

describe("Checkbox", () => {
  it("is a native checkbox with a 3:1 border token", () => {
    render(<Checkbox aria-label="Disabled" />);
    const box = screen.getByRole("checkbox", { name: "Disabled" });
    expect(box).toHaveClass("appearance-none", "border-muted-foreground", "checked:bg-primary", "forced-colors:appearance-auto");
  });
});

describe("CheckboxField", () => {
  it("checks the box from a click on its label, and is named by the label alone", async () => {
    const user = userEvent.setup();
    render(<CheckboxField label="Disabled" hint="Closes their sessions at once." />);
    const box = screen.getByRole("checkbox", { name: "Disabled" });
    expect(box).toHaveAccessibleDescription("Closes their sessions at once.");
    await user.click(screen.getByText("Disabled"));
    expect(box).toBeChecked();
    await user.click(screen.getByText("Closes their sessions at once."));
    expect(box).not.toBeChecked();
    expect(box.closest("label")).toHaveClass("min-h-11");
  });
});
