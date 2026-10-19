import { useCallback, useMemo, useRef, useState } from "react";

import { useAnnounce } from "./announcer";

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
