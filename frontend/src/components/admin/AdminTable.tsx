import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { type ComponentProps, type ReactNode, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import { useStrings } from "../../i18n/LocaleProvider";
import { type Tombstone, withTombstones } from "../../lib/admin-list";
import { Link } from "../Link";
import { Alert } from "../ui/alert";
import { rememberRow } from "./DetailPage";

export type Column<T> = {
  id: string;
  header: string;
  /** Keep the header for screen readers only (an icon column). */
  headerHidden?: boolean;
  cell: (row: T) => ReactNode;
  /**
   * Classes of the header and of every cell of the column: width, alignment, and the container width from which it
   * shows (`hidden @min-[40rem]/table:table-cell`). Hiding cells keeps the table a table: its own display never
   * changes, which some browsers read as a layout table.
   */
  className?: string;
  /** Make the header a sort button; rows compare on this value. */
  sortValue?: (row: T) => string | number;
};

export type SortState = { column: string; direction: "ascending" | "descending" };

export type TableSection<T> = {
  id: string;
  /** Heading row of the section (a row group header); none for the first or only one. */
  label?: string;
  rows: T[];
  /** Keep this section's order whatever the sort (built-in groups stay last, in their order). */
  fixed?: boolean;
};

type AdminTableProps<T extends { id: string }> = {
  /** Read by screen readers only: what the table lists and how to open a row. */
  caption: string;
  columns: Column<T>[];
  sections: TableSection<T>[];
  /** Id of the row whose detail is open: it is marked by a bar, its link by aria-current. */
  openId?: string | null;
  initialSort?: SortState;
  /** Messages that replaced deleted rows, put back where the row was. */
  tombstones?: readonly Tombstone[];
  /** Fixed layout, the widths given by the columns: several tables of the same columns then line up. */
  fixed?: boolean;
  className?: string;
};

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

function compare(a: string | number, b: string | number): number {
  return typeof a === "number" && typeof b === "number" ? a - b : collator.compare(String(a), String(b));
}

/**
 * Render an administration list as a real table: column headers, a caption for screen readers, sortable headers
 * with aria-sort, and one link per row (see {@link RowLink}) whose click area covers the whole row, so a row is one
 * tab stop and opens its detail. No action sits on the rows: they live in the detail pane. The table is a container,
 * so its columns hide by its own width, with a detail pane open as well as on a phone.
 */
export function AdminTable<T extends { id: string }>({ caption, columns, sections, openId = null, initialSort, tombstones = [], fixed = false, className }: AdminTableProps<T>) {
  const m = useStrings();
  const [sort, setSort] = useState<SortState | null>(initialSort ?? null);
  const sorted = useMemo(() => {
    const column = sort && columns.find((c) => c.id === sort.column);
    if (!sort || !column?.sortValue) return sections;
    const sign = sort.direction === "ascending" ? 1 : -1;
    return sections.map((section) =>
      section.fixed ? section : { ...section, rows: [...section.rows].sort((a, b) => sign * compare(column.sortValue!(a), column.sortValue!(b))) },
    );
  }, [sections, sort, columns]);

  const toggleSort = (id: string) =>
    setSort((prev) => ({ column: id, direction: prev?.column === id && prev.direction === "ascending" ? "descending" : "ascending" }));

  return (
    <div data-slot="admin-table" className={cn("@container/table", className)}>
      <table className={cn("w-full border-collapse text-left text-sm", fixed && "table-fixed")}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b-2 border-foreground/70">
            {columns.map((column) => {
              const direction = sort?.column === column.id ? sort.direction : undefined;
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={column.sortValue ? (direction ?? "none") : undefined}
                  className={cn("px-3 py-2 align-bottom font-normal whitespace-nowrap text-muted-foreground first:pl-4", column.className)}
                >
                  {column.headerHidden ? (
                    <span className="sr-only">{column.header}</span>
                  ) : column.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column.id)}
                      className="-mx-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className={cn(direction && "font-bold text-foreground")}>{column.header}</span>
                      {direction === "ascending" ? (
                        <ArrowUp aria-hidden="true" className="size-3.5" />
                      ) : direction === "descending" ? (
                        <ArrowDown aria-hidden="true" className="size-3.5" />
                      ) : (
                        <ArrowUpDown aria-hidden="true" className="size-3.5 opacity-60" />
                      )}
                      {direction && <span className="sr-only">, {direction === "ascending" ? m.admin.sortedAscending : m.admin.sortedDescending}</span>}
                    </button>
                  ) : (
                    <span className="inline-flex min-h-11 items-center">{column.header}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        {sorted.map((section) => (
          <tbody key={section.id}>
            {section.label && (
              <tr>
                <th scope="colgroup" colSpan={columns.length} className="px-4 pt-6 pb-2 text-left font-heading text-sm font-bold text-muted-foreground">
                  {section.label}
                </th>
              </tr>
            )}
            {withTombstones(section.rows, tombstones).map((entry) =>
              entry.kind === "tombstone" ? (
                <tr key={`tombstone-${entry.tombstone.id}`} data-slot="tombstone" className="border-b border-border">
                  <td colSpan={columns.length} className="px-2 py-2">
                    <Alert id={`tombstone-${entry.tombstone.id}`} variant={entry.tombstone.variant} autoFocus>
                      {entry.tombstone.text}
                    </Alert>
                  </td>
                </tr>
              ) : (
                <tr
                  key={entry.item.id}
                  data-open={entry.item.id === openId ? "" : undefined}
                  className="relative border-b-[1.5px] border-border focus-within:bg-accent hover:bg-accent data-open:bg-accent data-open:shadow-[inset_4px_0_0_var(--selected)]"
                >
                  {columns.map((column) => (
                    <td key={column.id} className={cn("px-3 py-3.5 align-top first:pl-4", column.className)}>
                      {column.cell(entry.item)}
                    </td>
                  ))}
                </tr>
              ),
            )}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/**
 * Link of a row, in its first text cell: its click area covers the whole row (the row is positioned), and it is the
 * row's one tab stop. With `listBase`, the list remembers it, to give it the focus back on return.
 */
export function RowLink({
  href,
  current = false,
  listBase,
  className,
  children,
  onClick,
  ...props
}: Omit<ComponentProps<"a">, "href"> & { href: string; current?: boolean; listBase?: string }) {
  return (
    <Link
      href={href}
      aria-current={current ? "true" : undefined}
      onClick={(e) => {
        if (listBase && props.id) rememberRow(listBase, props.id);
        onClick?.(e);
      }}
      className={cn(
        "font-medium text-foreground outline-none after:absolute after:inset-0 after:content-[''] hover:underline hover:decoration-link-decoration hover:decoration-2 hover:underline-offset-4 focus-visible:after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset aria-[current=true]:font-bold",
        className,
      )}
      {...props}
    >
      {children}
    </Link>
  );
}
