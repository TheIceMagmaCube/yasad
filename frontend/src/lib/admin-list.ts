import { type KeyboardEvent, useCallback, useMemo, useRef, useState } from "react";

import { useAnnounce } from "./announcer";
import { focusById } from "./focus";

export type RowPanel = {
  /** Return whether `key` (`edit:<id>`, `new`...) is the open panel. */
  isOpen: (key: string) => boolean;
  /** Return whether the open panel belongs to the row `id` (its key ends with `:<id>`). */
  holds: (id: string) => boolean;
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
      // From the ref: a request that ends calls it from the closure of its start.
      holds: (id) => current.current.key?.endsWith(`:${id}`) ?? false,
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
  /**
   * Rows shown whatever the filter: pinned ones until the filter changes, and rows with an error. The page adds
   * its own (open panel, temporary password).
   */
  kept: ReadonlySet<string>;
  /** Show a success in the status line, and read it once `after` (the focus move it follows) has settled. */
  say: (text: string, after?: Promise<unknown>) => void;
  /** Show a success in the status line only: the panel taking the focus already reads it. */
  note: (text: string) => void;
  /** Replace a row by a message; a row already replaced keeps its first message, read once. */
  bury: (tombstone: Tombstone) => void;
  /** Return whether a row was replaced by a message since the last clear. */
  isBuried: (id: string) => boolean;
  rowError: (id: string, text: string) => void;
  pin: (id: string) => void;
  /** Clear what the previous action left: status line, messages, row errors. Call it when an action starts. */
  clear: () => void;
  /** Clear it all, the pinned rows too: the filter changed. */
  clearForFilter: () => void;
};

/** Hold what an administration list shows after its actions: status line, tombstones, row errors, kept rows. */
export function useListFeedback(): ListFeedback {
  const announce = useAnnounce();
  const [status, setStatus] = useState("");
  const [tombstones, setTombstones] = useState<Tombstone[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set());
  // Read when a request ends, after renders that the closure of its start did not see.
  const buried = useRef(new Set<string>());

  const clear = useCallback(() => {
    setStatus("");
    setTombstones([]);
    setRowErrors({});
    buried.current = new Set();
  }, []);

  const kept = useMemo(() => new Set([...pinned, ...Object.keys(rowErrors)]), [pinned, rowErrors]);

  return useMemo<ListFeedback>(
    () => ({
      status,
      tombstones,
      rowErrors,
      kept,
      say: (text, after) => {
        setStatus(text);
        void Promise.resolve(after).then(() => announce(text));
      },
      note: setStatus,
      bury: (tombstone) => {
        if (buried.current.has(tombstone.id)) return;
        buried.current.add(tombstone.id);
        setTombstones((prev) => [...prev, tombstone]);
      },
      isBuried: (id) => buried.current.has(id),
      rowError: (id, text) => setRowErrors((prev) => ({ ...prev, [id]: text })),
      pin: (id) => setPinned((prev) => new Set(prev).add(id)),
      clear,
      clearForFilter: () => {
        clear();
        setPinned(new Set());
      },
    }),
    [status, tombstones, rowErrors, kept, announce, clear],
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
