import { type KeyboardEvent, useCallback, useMemo, useRef, useState } from "react";

import { useAnnounce } from "./announcer";
import { focusById } from "./focus";

export type RowPanel = {
  /** Return whether `key` (`edit:<id>`, `new`...) is the open panel. */
  isOpen: (key: string) => boolean;
  /** Open the panel, closing the other one without saving, or close it when it is the one open (its trigger clicked again). */
  toggle: (key: string) => void;
  close: () => void;
  /** Close the open panel and give the focus back to its trigger: Cancel, or Escape. */
  cancel: () => void;
  /**
   * Take hold of this opening of panel `key` when its request starts; the function returned says, when the
   * request ends, whether that same opening is still there. A panel closed then opened again is another opening:
   * its form is a new one, which never saw the request.
   */
  claim: (key: string) => () => boolean;
  /** Close the open panel on an Escape that nothing inside handled; put it on the page. */
  onKeyDown: (event: KeyboardEvent) => void;
};

/**
 * Hold the one panel open on an administration page; `triggerOf` gives the id of the button that opens a panel.
 * Pass a function defined outside the component, so the returned object changes only with the open panel.
 */
export function useRowPanel(triggerOf: (key: string) => string): RowPanel {
  const [open, setOpen] = useState<string | null>(null);
  // Read when a request ends, after renders that the closure of its start did not see. `opening` counts every
  // change, so two openings of the same panel differ.
  const current = useRef<{ key: string | null; opening: number }>({ key: null, opening: 0 });

  return useMemo<RowPanel>(() => {
    const set = (key: string | null) => {
      current.current = { key, opening: current.current.opening + 1 };
      setOpen(key);
    };
    const cancel = () => {
      const { key } = current.current;
      set(null);
      if (key) void focusById(triggerOf(key));
    };
    return {
      isOpen: (key) => open === key,
      toggle: (key) => set(current.current.key === key ? null : key),
      close: () => set(null),
      cancel,
      claim: (key) => {
        const held = current.current;
        if (held.key !== key) return () => false;
        return () => current.current === held;
      },
      onKeyDown: (event) => {
        if (event.key !== "Escape" || event.defaultPrevented || current.current.key === null) return;
        event.preventDefault();
        cancel();
      },
    };
  }, [open, triggerOf]);
}

/**
 * A row replaced by a message after a deletion, or after an action found it gone; it takes the focus. `index` is
 * its position in the list as rendered, `section` the list it belongs to on a page with several.
 */
export type Tombstone = { id: string; text: string; variant: "success" | "destructive"; index: number; section?: string };

export type ListFeedback = {
  /** Text of the toolbar status line: the last success. */
  status: string;
  tombstones: Tombstone[];
  /** Error of a request that ended after its panel was closed, shown in its row. */
  rowErrors: Record<string, string>;
  /** Row kept shown until the filter changes, though it may no longer match it. */
  pinned: string | null;
  /** Show a success in the status line, and read it once `after` (the focus move it follows) has settled. */
  say: (text: string, after?: Promise<unknown>) => void;
  /** Show a success in the status line only: the panel taking the focus already reads it. */
  note: (text: string) => void;
  /** Replace a row by a message. */
  bury: (tombstone: Tombstone) => void;
  rowError: (id: string, text: string) => void;
  pin: (id: string) => void;
  /** Clear what the previous action left: status line, messages, row errors. Call it when an action starts. */
  clear: () => void;
  /** Clear it all, the pinned row too: the filter changed. */
  clearForFilter: () => void;
};

/** Hold what an administration list shows after its actions: status line, tombstones, row errors, pinned row. */
export function useListFeedback(): ListFeedback {
  const announce = useAnnounce();
  const [status, setStatus] = useState("");
  const [tombstones, setTombstones] = useState<Tombstone[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [pinned, setPinned] = useState<string | null>(null);

  const clear = useCallback(() => {
    setStatus("");
    setTombstones([]);
    setRowErrors({});
  }, []);

  return useMemo<ListFeedback>(
    () => ({
      status,
      tombstones,
      rowErrors,
      pinned,
      say: (text, after) => {
        setStatus(text);
        void Promise.resolve(after).then(() => announce(text));
      },
      note: setStatus,
      bury: (tombstone) => setTombstones((prev) => [...prev.filter((t) => t.id !== tombstone.id), tombstone]),
      rowError: (id, text) => setRowErrors((prev) => ({ ...prev, [id]: text })),
      pin: setPinned,
      clear,
      clearForFilter: () => {
        clear();
        setPinned(null);
      },
    }),
    [status, tombstones, rowErrors, pinned, announce, clear],
  );
}

/** One entry of a rendered list: an item, or the message that replaced one. */
export type ListEntry<T> = { kind: "item"; item: T } | { kind: "tombstone"; tombstone: Tombstone };

/**
 * Return the items to render with the tombstones put back where their row was: a deleted row stays a message
 * in place, so the focus it holds is not lost when the list reloads without it.
 */
export function withTombstones<T extends { id: string }>(items: readonly T[], tombstones: readonly Tombstone[]): ListEntry<T>[] {
  const buried = new Map(tombstones.map((t) => [t.id, t]));
  const entries: ListEntry<T>[] = items.map((item) => {
    const tombstone = buried.get(item.id);
    buried.delete(item.id);
    return tombstone ? { kind: "tombstone", tombstone } : { kind: "item", item };
  });
  for (const tombstone of [...buried.values()].sort((a, b) => a.index - b.index)) {
    entries.splice(Math.min(tombstone.index, entries.length), 0, { kind: "tombstone", tombstone });
  }
  return entries;
}

/** Return whether the focus is inside the row titled by `titleId`: removing that row would drop it to the body. */
export function rowHasFocus(titleId: string): boolean {
  const row = document.getElementById(titleId)?.closest("li");
  return !!row && row.contains(document.activeElement);
}

/** Return whether nothing holds the focus (it fell to the body when its element was removed). */
export function focusIsLost(): boolean {
  return document.activeElement === null || document.activeElement === document.body;
}
