import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { NativeSelect } from "./native-select";

afterEach(cleanup);

describe("NativeSelect", () => {
  it("is a native select drawn with tokens and a hidden chevron, its class on the select itself", async () => {
    render(
      <NativeSelect aria-label="Role" className="custom" defaultValue="user">
        <option value="user">User</option>
        <option value="admin">Admin</option>
      </NativeSelect>,
    );
    const select = screen.getByRole("combobox", { name: "Role" });
    expect(select.tagName).toBe("SELECT");
    expect(select).toHaveClass("appearance-none", "forced-colors:appearance-auto", "border-input", "custom", "h-11");
    expect(select.parentElement!.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    await userEvent.setup().selectOptions(select, "admin");
    expect(select).toHaveValue("admin");
  });

  it("has a small size, and keeps the HTML size attribute out of its props", () => {
    render(<NativeSelect aria-label="Language" controlSize="sm" />);
    expect(screen.getByRole("combobox", { name: "Language" })).toHaveClass("h-9");
    // @ts-expect-error The HTML size attribute is replaced by controlSize.
    void (<NativeSelect size={3} />);
  });
});
