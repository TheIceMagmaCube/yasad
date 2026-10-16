import { LINK_GRID } from "./CategorySection";

/** Render the decorative placeholder shown while the links load: a heading bar and three cards. */
export function HomeSkeleton() {
  return (
    <div aria-hidden="true" data-slot="home-skeleton" className="motion-safe:animate-pulse">
      <div className="mb-4 h-7 w-40 rounded-md bg-muted" />
      <div className={LINK_GRID}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex h-20 items-start gap-3 rounded-xl border bg-card p-4">
            <div className="size-10 shrink-0 rounded-lg bg-muted" />
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
