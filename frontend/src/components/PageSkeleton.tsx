import { cn } from "@/lib/utils";

import { LINK_GRID } from "./home/CategorySection";

/**
 * Render the decorative placeholder shown while a page loads: a heading bar and three cards. It appears only
 * after 300 ms, so a quick load shows nothing.
 */
export function PageSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" data-slot="page-skeleton" className={cn("appear-delayed motion-safe:animate-pulse", className)}>
      <div className="mb-4 h-8 w-48 max-w-full rounded-md bg-muted" />
      <div className={LINK_GRID}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex h-20 items-start gap-3 rounded-2xl border-[1.5px] border-border bg-card p-4">
            <div className="pixel-corners size-11 shrink-0 bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 rounded bg-muted" />
              <div className="h-3 w-5/6 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
