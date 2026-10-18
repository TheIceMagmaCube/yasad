import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test-utils";
import { ConfirmPanel } from "./ConfirmPanel";
import { DataList, DataRow, ListSkeleton } from "./DataList";
import { SecretPanel } from "./SecretPanel";

afterEach(cleanup);

const row = () => document.querySelector('[data-slot="data-row"]')!;

describe("DataRow", () => {
  it("marks the row only while its panel is open", () => {
    const { rerender } = renderWithProviders(
      <DataList label="Users">
        <DataRow titleId="t" title="Ada" />
      </DataList>,
    );
    expect(row()).not.toHaveAttribute("data-open");
    rerender(
      <DataList label="Users">
        <DataRow titleId="t" title="Ada" panel={<p>Form</p>} />
      </DataList>,
    );
    expect(row()).toHaveAttribute("data-open");
    expect(screen.getByRole("listitem", { name: "Ada" })).toBe(row());
  });

  it("puts the leading tile before the title and moves the actions under the details on narrow screens", () => {
    renderWithProviders(
      <DataList label="Users">
        <DataRow titleId="t" title="Ada" leading={<span data-testid="tile" aria-hidden="true" />} actions={<button>Edit</button>} />
      </DataList>,
    );
    const grid = row().firstElementChild!;
    expect(grid.firstElementChild).toBe(screen.getByTestId("tile"));
    expect(screen.getByRole("button", { name: "Edit" }).parentElement).toHaveClass("col-start-2");
  });
});

describe("ListSkeleton", () => {
  it("draws a tile per row only for lists whose rows have one, hidden from assistive technologies", () => {
    const { rerender } = renderWithProviders(<ListSkeleton />);
    const list = document.querySelector('[data-slot="list-skeleton"]')!;
    expect(list).toHaveAttribute("aria-hidden", "true");
    expect(list.querySelectorAll('[data-slot="skeleton-tile"]')).toHaveLength(0);
    rerender(<ListSkeleton leading />);
    expect(document.querySelectorAll('[data-slot="skeleton-tile"]')).toHaveLength(4);
  });
});

describe("panels", () => {
  const confirm = (variant: "destructive" | "default") => (
    <ConfirmPanel question="Delete Ada?" confirmLabel="Delete" pendingLabel="Deleting" variant={variant} onConfirm={async () => {}} onCancel={() => {}} errorText={() => ""} />
  );

  it("marks a deletion with an edge and an icon besides its colour, and a reset with neither", () => {
    const { rerender } = renderWithProviders(confirm("destructive"));
    const panel = () => document.querySelector('[data-slot="confirm-panel"]')!;
    expect(panel()).toHaveClass("border-l-4");
    expect(panel().querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    rerender(confirm("default"));
    expect(panel()).not.toHaveClass("border-l-4");
    expect(panel().querySelector("p svg")).toBeNull();
  });

  // In forced colors the ring is gone. outline-hidden draws a transparent outline there, which the mode paints:
  // only on focus, or it would show at rest too and the focus could not be told apart. SecretPanel keeps no base
  // outline utility, so the boundary .panel draws in that mode stays at rest.
  it("draws a forced colors outline on the panels only while they have the focus", () => {
    renderWithProviders(
      <>
        {confirm("destructive")}
        <SecretPanel name="Ada" password="secret" autoFocus={false} onDone={() => {}} />
      </>,
    );
    for (const slot of ["confirm-panel", "secret-panel"]) {
      const panel = document.querySelector(`[data-slot="${slot}"]`)!;
      expect(panel).toHaveClass("focus-visible:outline-hidden");
      expect(panel).not.toHaveClass("outline-hidden");
    }
    const secret = document.querySelector('[data-slot="secret-panel"]')!;
    expect(secret).toHaveClass("panel");
    expect([...secret.classList].filter((c) => /^outline-/.test(c))).toEqual([]);
  });
});
