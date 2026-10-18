import { CircleCheck, Search } from "lucide-react";
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
      {/* One sunken strip holds the filter, the count and the main action, so they read as a single control. It keeps
          the card surface: on the muted one the ring of the primary button falls under 3:1. */}
      <div data-slot="toolbar-strip" className="sunken flex flex-wrap items-end gap-x-3 gap-y-3 rounded-xl border-[1.5px] border-border bg-card p-3 sm:gap-x-4 sm:p-4">
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1.5">
          <Label htmlFor={filterId}>{filterLabel}</Label>
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={filterId}
              type="search"
              autoComplete="off"
              data-focus-fallback=""
              className="pl-9"
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
        </div>
        <p data-slot="toolbar-count" className="mr-auto flex min-h-10 items-center font-mono text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {count}
        </p>
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
