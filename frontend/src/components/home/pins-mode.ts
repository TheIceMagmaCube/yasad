import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

import { useStrings } from "../../i18n/LocaleProvider";
import { useAnnounce } from "../../lib/announcer";
import { focusPage } from "../../lib/focus";

/**
 * Manage mode of the favourites, for the home entry `key` at `generation`.
 *
 * The mode is opened for one entry: when the entry is replaced (a session change, which empties the store), it is
 * closed, and the focus goes to the page heading if the element that held it is gone. It is never remembered. While
 * open, `html[data-pins-managing]` is set (scroll padding for the bar) and Escape closes it, unless another
 * component has already handled that key (`defaultPrevented`: the search box, a menu). Opening and closing are
 * announced; closing gives the focus back to the panel toggle (`toggleRef`).
 */
export function usePinsMode(
  key: string,
  generation: number | undefined,
): { managing: boolean; open(): void; close(): void; toggleRef: RefObject<HTMLButtonElement | null> } {
  const m = useStrings().home.pins;
  const announce = useAnnounce();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const entry = generation === undefined ? null : `${key}#${generation}`;
  const [openFor, setOpenFor] = useState<string | null>(null);
  const managing = entry !== null && openFor === entry;

  const open = useCallback(() => {
    if (entry === null) return;
    setOpenFor(entry);
    announce(m.modeOn);
  }, [entry, announce, m]);

  const close = useCallback(() => {
    setOpenFor(null);
    announce(m.modeOff);
    toggleRef.current?.focus();
  }, [announce, m]);

  useEffect(() => {
    if (!managing) return;
    const root = document.documentElement;
    root.setAttribute("data-pins-managing", "");
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeAttribute("data-pins-managing");
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [managing, close]);

  // Closed by a new entry rather than by Done or Escape: the focused button may have gone with the old content.
  const wasManaging = useRef(false);
  useEffect(() => {
    if (wasManaging.current && !managing) {
      const active = document.activeElement;
      if (!active || active === document.body || !active.isConnected) focusPage();
    }
    wasManaging.current = managing;
  }, [managing]);

  return { managing, open, close, toggleRef };
}
