import { useCallback, useSyncExternalStore } from "react";

type Clock = { now: number; listeners: Set<() => void>; timer: ReturnType<typeof setInterval> | null };

const clocks = new Map<number, Clock>();

function clockOf(intervalMs: number): Clock {
  let clock = clocks.get(intervalMs);
  if (!clock) {
    clock = { now: Date.now(), listeners: new Set(), timer: null };
    clocks.set(intervalMs, clock);
  }
  return clock;
}

function subscribe(intervalMs: number, listener: () => void): () => void {
  const clock = clockOf(intervalMs);
  clock.listeners.add(listener);
  if (clock.timer === null) {
    const tick = () => {
      clock.now = Date.now();
      for (const notify of clock.listeners) notify();
    };
    // A clock left by a render that never mounted holds an old instant.
    tick();
    clock.timer = setInterval(tick, intervalMs);
  }
  return () => {
    clock.listeners.delete(listener);
    if (clock.listeners.size > 0) return;
    if (clock.timer !== null) clearInterval(clock.timer);
    clocks.delete(intervalMs);
  };
}

/**
 * Return the current time, updated every `intervalMs`. Every component asking for the same interval shares one timer
 * and one instant, so two cards on a page never disagree on what is stale.
 */
export function useNow(intervalMs: number): number {
  // A new subscribe function would make React subscribe again on every render.
  const onChange = useCallback((listener: () => void) => subscribe(intervalMs, listener), [intervalMs]);
  return useSyncExternalStore(onChange, () => clockOf(intervalMs).now);
}
