import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu";

afterEach(cleanup);

describe("DropdownMenu", () => {
  it("edges the menu with a border and marks the highlighted item with an outline, both kept in forced colors mode", async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>First</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    const menu = screen.getByRole("menu");
    expect(menu).toHaveClass("border-[1.5px]", "border-border");
    expect(menu.className).not.toMatch(/shadow-\[0_0_0/);
    const item = screen.getByRole("menuitem", { name: "First" });
    expect(item).toHaveClass("focus:bg-accent", "focus:outline-2", "focus:outline-ring");
    // After outline-none, outline-2 resolves its style to none: only an explicit style makes the outline draw.
    expect(item).toHaveClass("outline-none", "focus:outline-solid");
  });
});
