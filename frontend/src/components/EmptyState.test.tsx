import { cleanup, render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";

import { EmptyState } from "./EmptyState";

afterEach(cleanup);

describe("EmptyState", () => {
  it("renders a decorative icon, title, text and actions", () => {
    const { container } = render(
      <EmptyState icon={Inbox} title="No links yet" actions={<button type="button">Add a link</button>}>
        Links you are allowed to see appear here.
      </EmptyState>,
    );
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("No links yet")).toBeInTheDocument();
    expect(screen.getByText("Links you are allowed to see appear here.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a link" })).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("border-dashed", "bg-card");
  });

  it("renders the title as a heading when asked", () => {
    render(<EmptyState title="No groups" titleAs="h2" />);
    expect(screen.getByRole("heading", { level: 2, name: "No groups" })).toBeInTheDocument();
  });
});
