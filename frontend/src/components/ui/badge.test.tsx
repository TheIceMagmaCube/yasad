import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Badge } from "./badge";

afterEach(cleanup);

describe("Badge", () => {
  it("defaults to the neutral variant", () => {
    render(<Badge>Local</Badge>);
    expect(screen.getByText("Local")).toHaveClass("bg-muted", "text-foreground", "text-xs", "font-medium");
  });

  it.each([
    ["primary", "bg-primary"],
    ["success", "bg-success-surface"],
    ["warning", "bg-warning-surface"],
    ["info", "bg-info-surface"],
    ["destructive", "bg-destructive-surface"],
    ["outline", "border-border"],
  ] as const)("renders the %s variant with its tokens", (variant, token) => {
    render(<Badge variant={variant}>Label</Badge>);
    expect(screen.getByText("Label")).toHaveClass(token);
  });
});
