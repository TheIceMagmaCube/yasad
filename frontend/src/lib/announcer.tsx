import { createContext, type ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useNavigations } from "./router";

type Announce = (text: string) => void;

/** Ignore announcements outside a provider, so a component renders alone in a test. */
const AnnounceContext = createContext<Announce>(() => {});

/**
 * Hold the one status region of the app and provide {@link useAnnounce}.
 *
 * Mount it once, around every view, so the region stays in the page while views change. Each announcement goes in
 * a new node, so the same text is read again. The region is emptied on every navigation.
 */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const navigations = useNavigations();
  // Read when announcing, so the function stays the same across navigations.
  const current = useRef(navigations);
  useLayoutEffect(() => {
    current.current = navigations;
  }, [navigations]);
  const [message, setMessage] = useState<{ text: string; n: number; navigations: number } | null>(null);
  const announce = useCallback<Announce>((text) => setMessage((prev) => ({ text, n: (prev?.n ?? 0) + 1, navigations: current.current })), []);
  const shown = message && message.navigations === navigations ? message : null;
  return (
    <AnnounceContext value={announce}>
      {children}
      <div role="status" aria-atomic="true" data-slot="announcer" className="sr-only">
        {shown && <span key={shown.n}>{shown.text}</span>}
      </div>
    </AnnounceContext>
  );
}

/** Return the function that reads a text to screen readers without moving the focus. */
export function useAnnounce(): Announce {
  return useContext(AnnounceContext);
}

/** Announce `text` once `active` has stayed true for `delay` ms, so quick operations stay silent. */
export function useAnnounceAfter(active: boolean, text: string, delay: number): void {
  const announce = useAnnounce();
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => announce(text), delay);
    return () => clearTimeout(timer);
  }, [active, text, delay, announce]);
}

/**
 * Announce `text` once it has stopped changing for `delay` ms: for counts that change on every key press (list
 * filter, member picker). An empty text announces nothing.
 */
export function useDebouncedStatus(text: string, delay = 500): void {
  useAnnounceAfter(text !== "", text, delay);
}
