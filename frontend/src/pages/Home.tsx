import { useEffect, useRef, useState } from "react";

import type { User } from "../api";
import { CategorySection, LINK_GRID, PANEL_LINK_GRID } from "../components/home/CategorySection";
import { HomeEmptyState } from "../components/home/HomeEmptyState";
import { type PinGestures, PinsPanel } from "../components/home/PinsPanel";
import { LoadError } from "../components/LoadError";
import { Page } from "../components/Page";
import { PageHeader } from "../components/PageHeader";
import { PageSkeleton } from "../components/PageSkeleton";
import { errorMessage } from "../i18n/errors";
import { useStrings } from "../i18n/LocaleProvider";
import { homeKey, type HomeState, loadHome, useHomeEntry } from "../lib/home-store";
import { useAnnounceAfter } from "../lib/announcer";
import { useDocumentTitle } from "../lib/page";

const LOADING: HomeState = { status: "loading" };

/** Gestures of the panel until the manage mode sends them. */
const NO_GESTURES: PinGestures = { move: () => {}, remove: () => {}, isPending: () => false };

/**
 * Home page: the categories and links the person may see, in catalog order.
 *
 * The data comes from the shared home store. A signed-in person gets a fresh request on every visit, with the
 * skeleton meanwhile; an anonymous visitor gets the public links the app already stored (fetched only when
 * missing). An answer for another viewer never reaches it: the store drops it and the app reloads the session.
 *
 * A signed-in person who sees at least one link also gets the favourites panel, first in the DOM; the categories
 * follow in `#home-links`, the target of the panel's skip link.
 */
export function Home({ user }: { user: User | null }) {
  const strings = useStrings();
  const m = strings.home;
  const title = user ? m.title : m.publicTitle;
  useDocumentTitle(title);
  const key = homeKey(user);
  const entry = useHomeEntry(key);
  const state = entry?.state ?? LOADING;
  const retrying = state.status === "error" && entry?.pending === true;
  const loading = state.status === "loading";
  const [managing, setManaging] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (user) loadHome(key, { reset: true });
    else if (entry?.state.status !== "ready") loadHome(key);
    // Loaded once per visit and viewer; the entry itself may change meanwhile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Said only when the wait lasts, like the skeleton, which appears after the same delay.
  useAnnounceAfter(loading, m.loading, 300);

  return (
    <Page width="list">
      <PageHeader title={title} />
      {loading ? (
        <PageSkeleton />
      ) : state.status === "error" ? (
        <LoadError attempt={state.attempt} message={`${m.loadError} ${errorMessage(state.error, strings)}`} pending={retrying} onRetry={() => loadHome(key)} />
      ) : state.data.categories.length === 0 ? (
        <HomeEmptyState empty={state.data.empty} />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem]">
          {user && (
            <PinsPanel
              categories={state.data.categories}
              pins={state.data.pins}
              managing={managing}
              onToggle={() => setManaging((open) => !open)}
              toggleRef={toggleRef}
              gestures={NO_GESTURES}
              error={null}
            />
          )}
          <div id="home-links" tabIndex={-1} className="min-w-0 space-y-10 outline-none">
            {state.data.categories.map((category, index) => (
              <CategorySection key={category.id} category={category} index={index} grid={user ? PANEL_LINK_GRID : LINK_GRID} />
            ))}
          </div>
        </div>
      )}
    </Page>
  );
}
