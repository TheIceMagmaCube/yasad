import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PageHeader } from "./PageHeader";
import { SectionHeader } from "./SectionHeader";

afterEach(cleanup);

describe("PageHeader", () => {
  it("renders a focusable h1 with eyebrow, description and actions", () => {
    render(<PageHeader eyebrow="Administration" title="Users" description="People who can sign in." actions={<button type="button">New user</button>} />);
    const heading = screen.getByRole("heading", { level: 1, name: "Users" });
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(heading).toHaveClass("text-display");
    heading.focus();
    expect(heading).toHaveFocus();
    const eyebrow = screen.getByText("Administration");
    expect(eyebrow).toHaveClass("text-pixel");
    expect(eyebrow.querySelector("span")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("People who can sign in.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New user" })).toBeInTheDocument();
  });

  it("renders only the title when nothing else is given", () => {
    const { container } = render(<PageHeader title="Home" />);
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });
});

describe("SectionHeader", () => {
  it("renders an h2 with its id, description and actions", () => {
    render(
      <section aria-labelledby="members">
        <SectionHeader id="members" title="Members" description="Who belongs to the group." actions={<button type="button">Add</button>} />
      </section>,
    );
    const heading = screen.getByRole("heading", { level: 2, name: "Members" });
    expect(heading).toHaveClass("text-section");
    expect(screen.getByRole("region", { name: "Members" })).toBeInTheDocument();
    expect(screen.getByText("Who belongs to the group.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });
});
