import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InlineForm } from "./InlineForm";

afterEach(cleanup);

describe("InlineForm", () => {
  it("focuses its first field on mount and skips validation by the browser", () => {
    render(
      <InlineForm aria-label="Rename" onCancel={vi.fn()}>
        <input type="hidden" name="id" />
        <input aria-label="Name" />
        <input aria-label="Other" />
      </InlineForm>,
    );
    expect(screen.getByLabelText("Name")).toHaveFocus();
    expect(screen.getByRole("form", { name: "Rename" })).toHaveAttribute("novalidate");
  });

  it("cancels on Escape", () => {
    const onCancel = vi.fn();
    render(
      <InlineForm onCancel={onCancel}>
        <input aria-label="Name" />
      </InlineForm>,
    );
    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("leaves an Escape handled further down alone", () => {
    const onCancel = vi.fn();
    render(
      <InlineForm onCancel={onCancel}>
        <input aria-label="Filter" onKeyDown={(e) => e.key === "Escape" && e.preventDefault()} />
      </InlineForm>,
    );
    fireEvent.keyDown(screen.getByLabelText("Filter"), { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
