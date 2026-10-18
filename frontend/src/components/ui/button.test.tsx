import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Link } from "../Link";

import { Button, buttonVariants } from "./button";

afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
});

describe("Button", () => {
  it("lets a given class override the variant's conflicting one, so a link styled as a button can wrap", () => {
    const classes = buttonVariants({ variant: "outline", className: "h-auto whitespace-normal" }).split(" ");
    expect(classes).toContain("whitespace-normal");
    expect(classes).not.toContain("whitespace-nowrap");
    expect(classes).not.toContain("h-10");
  });

  it("renders the destructive variants with their tokens", () => {
    render(
      <>
        <Button variant="destructive">Delete</Button>
        <Button variant="destructive-ghost">Remove</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass("bg-destructive", "text-destructive-foreground");
    expect(screen.getByRole("button", { name: "Remove" })).toHaveClass("text-destructive", "hover:bg-destructive-surface");
  });

  it("keeps focus and ignores clicks and submission while pending", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    function Form() {
      const [pending, setPending] = useState(false);
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
            setPending(true);
          }}
        >
          <input aria-label="Name" />
          <Button type="submit" pending={pending} pendingLabel="Saving…">
            Save
          </Button>
        </form>
      );
    }
    render(<Form />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    const button = screen.getByRole("button", { name: "Saving…" });
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();

    await user.click(button);
    await user.type(screen.getByLabelText("Name"), "x{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("calls onClick when not pending", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await userEvent.setup().click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Go" })).not.toHaveAttribute("aria-disabled");
  });

  it("blocks a slotted link while pending, from the mouse and the keyboard", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button asChild pending>
        <Link href="/admin/users" onClick={onClick}>
          Users
        </Link>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Users" });
    expect(link).toHaveAttribute("aria-disabled", "true");
    await user.click(link);
    link.focus();
    await user.keyboard("{Enter}");
    expect(onClick).not.toHaveBeenCalled();
    expect(location.pathname).toBe("/");
  });

  it("lets a slotted link navigate when not pending", async () => {
    render(
      <Button asChild>
        <Link href="/admin/users">Users</Link>
      </Button>,
    );
    await userEvent.setup().click(screen.getByRole("link", { name: "Users" }));
    expect(location.pathname).toBe("/admin/users");
  });

  it("keeps the children while pending without a label", () => {
    render(<Button pending>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("Button look", () => {
  const VARIANTS = ["default", "secondary", "outline", "ghost", "destructive", "destructive-ghost"] as const;

  it.each(VARIANTS)("gives the %s variant a transparent border, which forced colors mode draws as its boundary", (variant) => {
    const classes = buttonVariants({ variant }).split(" ");
    expect(classes).toContain("border-[1.5px]");
    expect(classes).toContain("border-transparent");
  });

  it("keeps a focus outline in forced colors mode, where the ring is dropped", () => {
    expect(buttonVariants().split(" ")).toContain("focus-visible:outline-hidden");
  });

  it.each([
    ["default", "[--relief-ring:var(--control-primary-ring)]"],
    ["secondary", "[--relief-ring:var(--control-ring)]"],
    ["outline", "[--relief-ring:var(--control-ring)]"],
  ] as const)("raises the %s variant on a hard base, edged by a 3:1 ring token", (variant, ring) => {
    const classes = buttonVariants({ variant }).split(" ");
    expect(classes).toContain("relief");
    expect(classes).toContain(ring);
  });
});
