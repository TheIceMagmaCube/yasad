import type { ReactNode } from "react";

import type { HomeData } from "../../api";
import { CategorySection, LINK_GRID, PANEL_LINK_GRID } from "../../components/home/CategorySection";
import { PinsPanel } from "../../components/home/PinsPanel";
import { LoadError } from "../../components/LoadError";
import { useStrings } from "../../i18n/LocaleProvider";
import type { AdminCollection } from "../../lib/admin-collection";

/** Id of the categories of the preview, the target of the favourites' skip link; one preview per page. */
const LINKS_ID = "preview-links";

type HomePreviewProps = {
  /** The home page, read through the admin API: never the home store, which holds the administrator's own. */
  home: AdminCollection<HomeData>;
  /** Name of the region, saying whose home page it is. */
  label: string;
  /** Name of the favourites panel; without it there is none, as for a visitor. */
  pinsLabel?: string;
  /** What the region shows when no link is visible. */
  empty: ReactNode;
};

/**
 * Render a home page as its viewer gets it, under an h2, on a sunken surface with a dashed border that sets it apart
 * from the administration around it. Same grid as the home page, its headings one level down (h3), the favourites
 * read only. The cards are the home page's own: a link opens with the rights of whoever clicks it.
 */
export function HomePreview({ home, label, pinsLabel, empty }: HomePreviewProps) {
  const m = useStrings();
  const data = home.data;
  return (
    <section aria-label={label} className="flex flex-col gap-3">
      <h2 className="text-section">{m.access.preview}</h2>
      {home.status === "error" ? (
        <LoadError attempt={home.attempt} message={m.access.loadError} pending={home.retrying} onRetry={home.retry} />
      ) : !data ? (
        <PreviewSkeleton />
      ) : data.categories.length === 0 ? (
        // The empty state is already a dashed, sunken slot: a second frame around it would nest two.
        empty
      ) : (
        <div data-slot="home-preview" className="sunken rounded-(--radius-card) border-2 border-dashed border-control-ring bg-background p-4 sm:p-6">
          <div className={pinsLabel ? "grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem]" : undefined}>
            {pinsLabel && <PinsPanel categories={data.categories} pins={data.pins} label={pinsLabel} level="h3" skipTarget={LINKS_ID} />}
            <div id={LINKS_ID} tabIndex={-1} className="min-w-0 space-y-10 outline-none">
              {data.categories.map((category, index) => (
                <CategorySection key={category.id} category={category} index={index} grid={pinsLabel ? PANEL_LINK_GRID : LINK_GRID} level="h3" />
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** Return a placeholder of the preview while it loads, shown after the same delay as the lists'. */
export function PreviewSkeleton() {
  return <div aria-hidden="true" className="appear-delayed h-64 rounded-(--radius-card) bg-muted motion-safe:animate-pulse" />;
}
