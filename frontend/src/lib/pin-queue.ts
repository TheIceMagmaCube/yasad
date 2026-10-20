import { useCallback, useRef, useState } from "react";

type Gesture = { id: string; run: () => Promise<void> };

/**
 * Run the pin gestures one at a time, first asked first sent, so their answers apply in the order they were sent.
 *
 * `enqueue(id, run)` adds a gesture; `id` names the button that asked for it, which `isPending` reports from the
 * enqueue until its `run` settles. A failed gesture does not stop the ones after it: `run` handles its own errors.
 */
export function useGestureQueue(): { enqueue(id: string, run: () => Promise<void>): void; isPending(id: string): boolean } {
  const queue = useRef<Gesture[]>([]);
  const running = useRef(false);
  /** Gestures queued or in flight per id; a button may be pressed again before its first gesture is done. */
  const [pending, setPending] = useState<ReadonlyMap<string, number>>(new Map());

  const adjust = useCallback((id: string, delta: number) => {
    setPending((current) => {
      const next = new Map(current);
      const count = (next.get(id) ?? 0) + delta;
      if (count > 0) next.set(id, count);
      else next.delete(id);
      return next;
    });
  }, []);

  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    let gesture: Gesture | undefined;
    while ((gesture = queue.current.shift())) {
      try {
        await gesture.run();
      } catch {
        // The gesture reports its own failure; the next one still goes.
      } finally {
        adjust(gesture.id, -1);
      }
    }
    running.current = false;
  }, [adjust]);

  const enqueue = useCallback(
    (id: string, run: () => Promise<void>) => {
      queue.current.push({ id, run });
      adjust(id, 1);
      void drain();
    },
    [adjust, drain],
  );

  const isPending = useCallback((id: string) => pending.has(id), [pending]);

  return { enqueue, isPending };
}
