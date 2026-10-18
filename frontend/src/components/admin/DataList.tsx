import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import type { Tombstone } from "../../lib/admin-list";
import { SectionHeader } from "../SectionHeader";
import { Alert } from "../ui/alert";

/** Render a compact list of administration rows; label it, as a page may hold several. */
export function DataList({ label, labelledBy, className, children }: { label?: string; labelledBy?: string; className?: string; children: ReactNode }) {
  return (
    <ul aria-label={label} aria-labelledby={labelledBy} className={cn("panel divide-y-[1.5px] divide-border overflow-hidden", className)}>
      {children}
    </ul>
  );
}

type DataRowProps = {
  /** Id of the row title, which names the row. */
  titleId: string;
  title: ReactNode;
  /** Decorative tile before the title (initials of a person); the caller hides it from assistive technologies. */
  leading?: ReactNode;
  badges?: ReactNode;
  /** Details under the title, one line each. */
  meta?: ReactNode;
  /** Row actions: right of the details from sm up, on a line of their own below on narrow screens. */
  actions?: ReactNode;
  /** Error of a request that ended after its panel was closed. */
  error?: string;
  /** Open panel (form, confirmation, secret), across the full width under the row. */
  panel?: ReactNode;
};

/**
 * Render one row: title and badges on the first line, details below, actions at the end, then the open panel.
 * The title is a paragraph, not a heading, so a long list does not flood the page outline.
 *
 * A row with an open panel carries a bar on its start edge, so the panel reads as part of it. The row keeps the card
 * surface: a tint would bring the destructive text of its buttons under 4.5:1.
 */
export function DataRow({ titleId, title, leading, badges, meta, actions, error, panel }: DataRowProps) {
  // From sm up the panel and the error line up with the title, past the 40 px tile and its gap.
  const indent = leading ? "sm:pl-[4.5rem]" : undefined;
  return (
    <li
      aria-labelledby={titleId}
      data-slot="data-row"
      data-open={panel ? "" : undefined}
      className="data-open:shadow-[inset_4px_0_0_var(--selected)]"
    >
      <div
        className={cn(
          "grid items-start gap-x-3 gap-y-3 px-4 py-3.5 sm:gap-x-4",
          leading ? "grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,1fr)_auto]" : "grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto]",
        )}
      >
        {leading}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p id={titleId} className="font-heading text-base leading-6 font-bold wrap-anywhere">
              {title}
            </p>
            {badges}
          </div>
          {meta && <div className="mt-1 flex flex-col gap-1 text-sm text-muted-foreground">{meta}</div>}
        </div>
        {actions && <div className={cn("flex flex-wrap items-center gap-2 sm:justify-end", leading && "col-start-2 sm:col-start-auto")}>{actions}</div>}
      </div>
      {error && (
        <div className={cn("px-4 pb-4", indent)}>
          <Alert variant="destructive">{error}</Alert>
        </div>
      )}
      {panel && <div className={cn("border-t-[1.5px] border-dashed border-border px-4 pt-4 pb-5", indent)}>{panel}</div>}
    </li>
  );
}

/** Render the message that replaced a row; it takes the focus, and Tab goes on to the next row. */
export function TombstoneRow({ tombstone }: { tombstone: Tombstone }) {
  return (
    <li data-slot="tombstone" className="px-4 py-3.5">
      <Alert variant={tombstone.variant} autoFocus>
        {tombstone.text}
      </Alert>
    </li>
  );
}

/** Render a titled part of a list page (h2), hidden by the caller when it has nothing to show. */
export function DataListSection({ id, title, description, children }: { id: string; title: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col">
      <SectionHeader id={id} title={title} description={description} className="mb-3" />
      {children}
    </section>
  );
}

/**
 * Render the decorative rows shown while a list loads; they appear only after 300 ms, so a quick load shows nothing.
 * `leading` draws a tile before each row, for lists whose rows have one.
 */
export function ListSkeleton({ leading = false }: { leading?: boolean }) {
  return (
    <ul aria-hidden="true" data-slot="list-skeleton" className="appear-delayed panel divide-y-[1.5px] divide-border overflow-hidden motion-safe:animate-pulse">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="flex items-start gap-3 px-4 py-3.5 sm:gap-4">
          {leading && <div data-slot="skeleton-tile" className="pixel-corners size-10 shrink-0 bg-muted" />}
          <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
            <div className="h-4 w-40 max-w-full rounded-sm bg-muted" />
            <div className="h-3 w-64 max-w-full rounded-sm bg-muted" />
          </div>
        </li>
      ))}
    </ul>
  );
}
