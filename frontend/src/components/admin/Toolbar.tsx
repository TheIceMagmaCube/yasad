import { CircleCheck } from "lucide-react";
import type { ReactNode } from "react";

import { useDebouncedStatus } from "../../lib/announcer";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

type ToolbarProps = {
  /** Id of the filter field, also the focus fallback of the page. */
  filterId: string;
  filterLabel: string;
  query: string;
  onQueryChange: (query: string) => void;
  /** Visible count ("12 users", "3 of 12 users"), read once the person stops typing in the filter, and only then. */
  count: string;
  /** Main action of the page; it stays mounted while its panel is open. */
  action?: ReactNode;
  /** Text of the last success, shown with an icon; the announcer reads it, so the line is no live region. */
  status: string;
};

/**
 * Render the head of an administration list: filter, count and main action, then the status line, mounted at
 * all times so that a success never shifts the page.
 *
 * Escape in a filter that holds text clears it, and stops there; in an empty filter it goes on to the page, which
 * closes the open panel.
 */
export function Toolbar({ filterId, filterLabel, query, onQueryChange, count, action, status }: ToolbarProps) {
  useDebouncedStatus(query, count);
  return (
    <div data-slot="toolbar" className="mb-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1.5">
          <Label htmlFor={filterId}>{filterLabel}</Label>
          <Input
            id={filterId}
            type="search"
            autoComplete="off"
            data-focus-fallback=""
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape" || query === "") return;
              e.preventDefault();
              e.stopPropagation();
              onQueryChange("");
            }}
          />
        </div>
        <p className="min-h-10 py-2.5 text-sm text-muted-foreground">{count}</p>
        {action}
      </div>
      <p data-slot="toolbar-status" className="flex min-h-5 items-start gap-1.5 text-sm">
        {status && (
          <>
            <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            <span>{status}</span>
          </>
        )}
      </p>
    </div>
  );
}
