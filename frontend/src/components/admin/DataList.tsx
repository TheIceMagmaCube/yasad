import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import type { Tombstone } from "../../lib/admin-list";
import { SectionHeader } from "../SectionHeader";
import { Alert } from "../ui/alert";

/** Render a compact list of administration rows; label it, as a page may hold several. */
export function DataList({ label, labelledBy, className, children }: { label?: string; labelledBy?: string; className?: string; children: ReactNode }) {
  return (
    <ul aria-label={label} aria-labelledby={labelledBy} className={cn("divide-y divide-border rounded-xl border bg-card text-card-foreground", className)}>
      {children}
    </ul>
  );
}

type DataRowProps = {
  /** Id of the row title, which names the row. */
  titleId: string;
  title: ReactNode;
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
 */
export function DataRow({ titleId, title, badges, meta, actions, error, panel }: DataRowProps) {
  return (
    <li aria-labelledby={titleId} data-slot="data-row">
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 p-4 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p id={titleId} className="font-semibold wrap-anywhere">
              {title}
            </p>
            {badges}
          </div>
          {meta && <div className="mt-1 flex flex-col gap-0.5 text-sm text-muted-foreground">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-start gap-2 sm:justify-end">{actions}</div>}
      </div>
      {error && (
        <div className="px-4 pb-4">
          <Alert variant="destructive">{error}</Alert>
        </div>
      )}
      {panel && <div className="border-t border-border bg-muted/40 p-4">{panel}</div>}
    </li>
  );
}

/** Render the message that replaced a row; it takes the focus, and Tab goes on to the next row. */
export function TombstoneRow({ tombstone }: { tombstone: Tombstone }) {
  return (
    <li data-slot="tombstone" className="p-4">
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

/** Render the decorative rows shown while a list loads; they appear only after 300 ms, so a quick load shows nothing. */
export function ListSkeleton() {
  return (
    <ul aria-hidden="true" data-slot="list-skeleton" className="appear-delayed divide-y divide-border rounded-xl border bg-card motion-safe:animate-pulse">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="flex flex-col gap-2 p-4">
          <div className="h-4 w-40 rounded bg-muted" />
          <div className="h-3 w-64 max-w-full rounded bg-muted" />
        </li>
      ))}
    </ul>
  );
}
