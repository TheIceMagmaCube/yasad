import { type ReactNode, useEffect, useId, useState } from "react";

import { cn } from "@/lib/utils";

import { claimFocus } from "../../lib/focus";

/** Maximum width of an admin item page (1024 px), so a label stays near its value in the wide app column. */
export const ITEM_WIDTH = "max-w-5xl";

/**
 * Lay out an item page: two columns from lg (what the item is at the left, what it belongs to at the right), one
 * below; the actions that lose data under both, full width. At most `ITEM_WIDTH` wide.
 */
export function DetailColumns({ main, side, danger }: { main: ReactNode; side?: ReactNode; danger?: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-10", ITEM_WIDTH)}>
      <div className={cn("grid grid-cols-1 gap-10", side && "lg:grid-cols-2 lg:gap-12")}>
        <div className="flex min-w-0 flex-col gap-10">{main}</div>
        {side && <div className="flex min-w-0 flex-col gap-10">{side}</div>}
      </div>
      {danger}
    </div>
  );
}

/** Render a titled part of an item page (h2). */
export function PaneSection({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("flex flex-col gap-3", className)}>
      <h2 id={id} className="text-section">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Render the bottom of an item page, set apart: the actions that lose data. */
export function PaneDanger({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4 border-t-[1.5px] border-dashed border-border pt-6">{children}</div>;
}

/**
 * The list an item page was opened from, by list address: the address with its filter, and the row link that
 * opened it. The item page links back there, and the list gives the focus back to that row.
 */
const opened = new Map<string, { href: string; linkId: string }>();

/** Note that the row `linkId` of the list at `base` is being opened, with the filter now in the address. */
export function rememberRow(base: string, linkId: string): void {
  opened.set(base, { href: location.pathname === base ? base + location.search : base, linkId });
}

/** Return the address of the list at `base` as it was left, filter included. */
export function listHref(base: string): string {
  return opened.get(base)?.href ?? base;
}

/**
 * Give the focus back to the row that opened an item page, once the list at `base` shows again (`ready`), whether
 * by the back link or the browser's Back; a deleted item's row is replaced by a message, which takes it instead.
 * Claimed, so the page focus of the navigation leaves it there.
 */
export function useRestoreRow(base: string, ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    const entry = opened.get(base);
    if (!entry?.linkId) return;
    opened.set(base, { ...entry, linkId: "" });
    const target = document.getElementById(entry.linkId);
    if (!target) return;
    target.focus();
    claimFocus();
  }, [base, ready]);
}

/**
 * Hold a list setting in the address query (`?q=`, `?group=`), so the back link and the browser's Back find the
 * list as it was left. The address is replaced, not pushed: typing in a filter adds no history entry.
 */
export function useQueryState(key: string): [string, (value: string) => void] {
  const [value, setValue] = useState(() => new URLSearchParams(location.search).get(key) ?? "");
  const set = (next: string) => {
    setValue(next);
    const params = new URLSearchParams(location.search);
    if (next) params.set(key, next);
    else params.delete(key);
    const query = params.toString();
    history.replaceState(history.state, "", location.pathname + (query ? `?${query}` : ""));
  };
  return [value, set];
}
