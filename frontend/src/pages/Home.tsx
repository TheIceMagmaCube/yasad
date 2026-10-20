import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { api, ApiError, type HomeLink, type User } from "../api";
import { CategorySection, LINK_GRID, PANEL_LINK_GRID } from "../components/home/CategorySection";
import { HomeEmptyState } from "../components/home/HomeEmptyState";
import { ManageBar } from "../components/home/ManageBar";
import { usePinsMode } from "../components/home/pins-mode";
import { type PinGestures, pinnedLinks, PinsPanel } from "../components/home/PinsPanel";
import { LoadError } from "../components/LoadError";
import { Page } from "../components/Page";
import { PageHeader } from "../components/PageHeader";
import { PageSkeleton } from "../components/PageSkeleton";
import { errorMessage } from "../i18n/errors";
import { useStrings } from "../i18n/LocaleProvider";
import { useAnnounce, useAnnounceAfter } from "../lib/announcer";
import { focusById } from "../lib/focus";
import { type HomeEntry, homeKey, type HomeState, loadHome, setHomePins, useHomeEntry } from "../lib/home-store";
import { useDocumentTitle } from "../lib/page";
import { useGestureQueue } from "../lib/pin-queue";

const LOADING: HomeState = { status: "loading" };

const cardPinId = (linkId: string) => `pin-card-${linkId}`;

/**
 * Home page: the categories and links the person may see, in catalog order.
 *
 * The data comes from the shared home store. A signed-in person gets a fresh request on every visit, with the
 * skeleton meanwhile; an anonymous visitor gets the public links the app already stored (fetched only when
 * missing). An answer for another viewer never reaches it: the store drops it and the app reloads the session.
 *
 * A signed-in person who sees at least one link also gets the favourites panel, first in the DOM; the categories
 * follow in `#home-links`, the target of the panel's skip link.
 *
 * In the manage mode, each card gets a Pin button and each favourite Up, Down and Remove. Gestures go through one
 * queue, one in flight; each answer patches the pins of the entry the gesture was sent for (see `setHomePins`), and
 * is announced without moving the focus, except Remove, whose button goes: the focus moves to the next Remove, else
 * the previous one, else the panel toggle. A refused gesture shows a focused alert in the panel.
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
  const pinsMode = usePinsMode(key, entry?.generation);
  const { managing } = pinsMode;
  const announce = useAnnounce();
  const queue = useGestureQueue();
  const [error, setError] = useState<{ text: string; n: number } | null>(null);
  // Read by the gestures when they are sent, which may be after later renders.
  const entryRef = useRef<HomeEntry | null>(entry);
  useLayoutEffect(() => {
    entryRef.current = entry;
  });
  const pins = state.status === "ready" ? state.data.pins : undefined;
  // Set by a card gesture: once its pins are shown, the focused button is scrolled back into view, as the panel above
  // it may have grown or shrunk.
  const scrollAfterPins = useRef(false);
  useLayoutEffect(() => {
    if (!scrollAfterPins.current) return;
    scrollAfterPins.current = false;
    document.activeElement?.scrollIntoView({ block: "nearest" });
  }, [pins]);

  /** The data of the entry as it stands now, when it is ready. */
  const current = () => (entryRef.current?.state.status === "ready" ? entryRef.current.state.data : null);
  const titleOf = (linkId: string) =>
    current()
      ?.categories.flatMap((category) => category.links)
      .find((link) => link.id === linkId)?.title ?? linkId;

  /**
   * Queue a gesture under `buttonId`. When it is sent, the generation of the entry is read; the answer patches it
   * and `done` runs, unless the entry was replaced meanwhile (the reload `setHomePins` starts then shows the result).
   */
  function gesture(buttonId: string, request: () => Promise<{ pins: string[] }>, done: (pins: string[], before: string[]) => void) {
    queue.enqueue(buttonId, async () => {
      setError(null);
      const generation = entryRef.current?.generation ?? -1;
      const before = current()?.pins ?? [];
      try {
        const { pins: after } = await request();
        if (setHomePins(key, generation, after)) done(after, before);
      } catch (err) {
        const code = err instanceof ApiError ? err.body.code : null;
        const text = code === "pins_full" ? m.pins.full(err instanceof ApiError ? (err.body.max ?? 20) : 20) : code === "not_found" ? m.pins.gone : m.pins.saveError;
        setError((prev) => ({ text, n: (prev?.n ?? 0) + 1 }));
        // The link was removed or hidden meanwhile: the home is read again, the mode stays open.
        if (code === "not_found") loadHome(key);
      }
    });
  }

  const pin = (link: HomeLink) =>
    gesture(
      cardPinId(link.id),
      () => api.pin(link.id),
      (after) => {
        scrollAfterPins.current = true;
        announce(m.pins.announcePinned(link.title, after.indexOf(link.id) + 1, after.length));
      },
    );

  const unpin = (link: HomeLink) =>
    gesture(
      cardPinId(link.id),
      () => api.unpin(link.id),
      () => {
        scrollAfterPins.current = true;
        announce(m.pins.announceUnpinned(link.title));
      },
    );

  const gestures: PinGestures = {
    move: (id, direction, buttonId) =>
      gesture(
        buttonId,
        () => api.movePin(id, direction),
        (after) => {
          // Rows keep their React key, so the button keeps the focus; this only covers a browser that dropped it.
          void focusById(buttonId);
          announce(strings.links.position(titleOf(id), after.indexOf(id) + 1, after.length));
        },
      ),
    remove: (id) => {
      const title = titleOf(id);
      gesture(
        `pin-remove-${id}`,
        () => api.unpin(id),
        (_after, before) => {
          const shown = pinnedLinks(current()?.categories ?? [], before).map(({ link }) => link.id);
          const at = shown.indexOf(id);
          const next = at >= 0 ? shown[at + 1] : undefined;
          const previous = at > 0 ? shown[at - 1] : undefined;
          void focusById([next, previous].flatMap((other) => (other ? [`pin-remove-${other}`] : [])).concat("pins-toggle"));
          announce(m.pins.announceUnpinned(title));
        },
      );
    },
    isPending: queue.isPending,
  };

  // An alert of a former session of the mode must not come back, focused, when it opens again.
  const openMode = () => {
    setError(null);
    pinsMode.open();
  };

  const pinned = new Set(pins);
  const cardPin = managing
    ? (link: HomeLink) => ({
        id: cardPinId(link.id),
        pinned: pinned.has(link.id),
        pending: queue.isPending(cardPinId(link.id)),
        onToggle: () => (pinned.has(link.id) ? unpin(link) : pin(link)),
      })
    : undefined;

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
              onToggle={managing ? pinsMode.close : openMode}
              toggleRef={pinsMode.toggleRef}
              gestures={gestures}
              // A refused gesture's alert goes with the mode.
              error={managing ? error : null}
            />
          )}
          <div id="home-links" tabIndex={-1} className="min-w-0 space-y-10 outline-none">
            {state.data.categories.map((category, index) => (
              <CategorySection key={category.id} category={category} index={index} grid={user ? PANEL_LINK_GRID : LINK_GRID} pin={cardPin} />
            ))}
          </div>
          {managing && (
            <div className="lg:col-span-2">
              <ManageBar onDone={pinsMode.close} />
            </div>
          )}
        </div>
      )}
    </Page>
  );
}
