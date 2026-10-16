import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Alert } from "./alert";

afterEach(cleanup);

describe("Alert", () => {
  it.each([
    ["info", "status", "bg-info-surface", "border-info"],
    ["success", "status", "bg-success-surface", "border-success"],
    ["warning", "alert", "bg-warning-surface", "border-warning"],
    ["destructive", "alert", "bg-destructive-surface", "border-destructive"],
  ] as const)("gives the %s tone the %s role and its tokens", (tone, role, surface, border) => {
    render(<Alert tone={tone}>Body</Alert>);
    const alert = screen.getByRole(role);
    expect(alert).toHaveTextContent("Body");
    expect(alert).toHaveClass(surface, border);
    expect(alert.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("lets the role be overridden", () => {
    render(
      <Alert tone="warning" role="note">
        Body
      </Alert>,
    );
    expect(screen.getByRole("note")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the title before the body", () => {
    render(
      <Alert tone="success" title="Saved">
        The link is updated.
      </Alert>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("SavedThe link is updated.");
  });

  it("is not focusable without autoFocus", () => {
    render(<Alert tone="destructive">Error</Alert>);
    expect(screen.getByRole("alert")).not.toHaveAttribute("tabindex");
    expect(screen.getByRole("alert")).not.toHaveFocus();
  });

  it("takes focus on mount with autoFocus", () => {
    render(
      <Alert tone="destructive" title="Check the highlighted fields." autoFocus>
        Two fields need attention.
      </Alert>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("tabindex", "-1");
    expect(alert).toHaveFocus();
  });
});
