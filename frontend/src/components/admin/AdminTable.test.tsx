import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { Tombstone } from "../../lib/admin-list";
import { renderWithProviders } from "../../test-utils";
import { AdminTable, type Column, RowLink } from "./AdminTable";

afterEach(cleanup);

type Row = { id: string; name: string; seen: number };
const ROWS: Row[] = [
  { id: "b", name: "Bob", seen: 3 },
  { id: "a", name: "ada", seen: 1 },
  { id: "c", name: "Carol", seen: 2 },
];
const COLUMNS: Column<Row>[] = [
  { id: "name", header: "Name", sortValue: (r) => r.name, cell: (r) => <RowLink id={`row-${r.id}`} href={`/items/${r.id}`}>{r.name}</RowLink> },
  { id: "seen", header: "Seen", sortValue: (r) => r.seen, cell: (r) => String(r.seen) },
  { id: "note", header: "Note", cell: () => "-" },
];

const names = () => screen.getAllByRole("link").map((a) => a.textContent);

function renderTable(props: Partial<Parameters<typeof AdminTable<Row>>[0]> = {}) {
  renderWithProviders(<AdminTable caption="Items" columns={COLUMNS} sections={[{ id: "all", rows: ROWS }]} {...props} />);
  return userEvent.setup();
}

describe("AdminTable", () => {
  it("is a captioned table whose sortable headers are buttons carrying aria-sort", async () => {
    const user = renderTable({ initialSort: { column: "name", direction: "ascending" } });
    const table = screen.getByRole("table", { name: "Items" });
    const [name, seen, note] = within(table).getAllByRole("columnheader");
    expect(name).toHaveAttribute("aria-sort", "ascending");
    expect(seen).toHaveAttribute("aria-sort", "none");
    expect(note).not.toHaveAttribute("aria-sort");
    expect(within(note!).queryByRole("button")).toBeNull();
    // Case does not count: "ada" sorts before "Bob".
    expect(names()).toEqual(["ada", "Bob", "Carol"]);

    await user.click(within(name!).getByRole("button", { name: "Name, sorted ascending" }));
    expect(name).toHaveAttribute("aria-sort", "descending");
    expect(names()).toEqual(["Carol", "Bob", "ada"]);

    await user.click(within(seen!).getByRole("button", { name: "Seen" }));
    expect(seen).toHaveAttribute("aria-sort", "ascending");
    expect(name).toHaveAttribute("aria-sort", "none");
    expect(names()).toEqual(["ada", "Carol", "Bob"]);
  });

  it("keeps the order of a fixed section whatever the sort", async () => {
    const user = renderTable({
      sections: [
        { id: "mine", rows: ROWS },
        { id: "built-in", label: "Built-in", rows: [{ id: "z", name: "Zed", seen: 0 }, { id: "y", name: "Yan", seen: 9 }], fixed: true },
      ],
    });
    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(names()).toEqual(["ada", "Bob", "Carol", "Zed", "Yan"]);
    expect(screen.getByRole("columnheader", { name: "Built-in" })).toHaveAttribute("scope", "colgroup");
  });

  it("gives each row one link, the row's only tab stop, and marks the open one's row", async () => {
    const user = renderTable({ openId: "b" });
    const row = screen.getByRole("link", { name: "Bob" }).closest("tr")!;
    expect(row).toHaveClass("relative");
    expect(row).toHaveAttribute("data-open");
    expect(screen.getByRole("link", { name: "Carol" }).closest("tr")).not.toHaveAttribute("data-open");
    expect(within(row).getAllByRole("link")).toHaveLength(1);

    // The two sort buttons, then one stop per row.
    await user.tab();
    await user.tab();
    await user.tab();
    expect(screen.getByRole("link", { name: "Bob" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "ada" })).toHaveFocus();
  });

  it("puts a deleted row's message where the row was, focused", () => {
    const tombstone: Tombstone = { id: "a", text: "ada deleted.", variant: "success", index: 1 };
    renderTable({ sections: [{ id: "all", rows: ROWS.filter((r) => r.id !== "a") }], tombstones: [tombstone] });
    const message = screen.getByRole("group", { name: "ada deleted." });
    expect(message).toHaveFocus();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[1]).toContainElement(message);
    expect(within(rows[1]!).getByRole("cell")).toHaveAttribute("colspan", "3");
  });
});
