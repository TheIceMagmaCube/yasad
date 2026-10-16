import { useSyncExternalStore } from "react";

import { api, type HomeData } from "@/api";

export type HomeState =
  | { status: "loading" }
  | { status: "ready"; data: HomeData }
  /** `attempt` changes on every failure, so the error can be announced again. */
  | { status: "error"; error: unknown; attempt: number };

/**
 * The one cached home answer, shared by the home page and the header search.
 *
 * `key` says whose data it is (`anonymous` or `user:<id>`); `generation` changes whenever the entry is replaced,
 * so an answer that arrives for an older one is dropped. `pending` says a request is running.
 */
export type HomeEntry = { key: string; generation: number; state: HomeState; pending: boolean };

let entry: HomeEntry | null = null;
/** Never reset, so an answer from before a reset can never match a newer entry. */
let generation = 0;
let failures = 0;
let inflight: { generation: number; promise: Promise<void> } | null = null;
const listeners = new Set<() => void>();

function set(next: HomeEntry | null): void {
  entry = next;
  for (const listener of listeners) listener();
}

/** Return the cache key of a viewer: `anonymous`, or `user:<id>`. */
export function homeKey(user: { id: string } | null): string {
  return user ? `user:${user.id}` : "anonymous";
}

/**
 * Request the home data of `key`, unless a request for the same entry is already running.
 *
 * A different key replaces the entry. With `reset`, the entry goes back to loading first (the home page shows
 * its skeleton on every visit); otherwise the current data stays until the answer arrives. Answers for a
 * replaced or invalidated entry are ignored.
 */
export function loadHome(key: string, { reset = false }: { reset?: boolean } = {}): void {
  if (entry?.key !== key) {
    generation += 1;
    inflight = null;
    set({ key, generation, state: { status: "loading" }, pending: false });
  } else if (reset && entry.state.status !== "loading") {
    set({ ...entry, state: { status: "loading" } });
  }
  const current = entry!;
  if (inflight?.generation === current.generation) return;

  const gen = current.generation;
  const isCurrent = () => entry?.key === key && entry.generation === gen;
  set({ ...current, pending: true });
  const promise = api.home().then(
    (data) => {
      if (isCurrent()) set({ ...entry!, state: { status: "ready", data }, pending: false });
    },
    (error: unknown) => {
      if (!isCurrent()) return;
      failures += 1;
      set({ ...entry!, state: { status: "error", error, attempt: failures }, pending: false });
    },
  );
  inflight = { generation: gen, promise };
  void promise.finally(() => {
    if (inflight?.promise === promise) inflight = null;
  });
}

/** Store an answer already fetched for `key` (the anonymous home, loaded by the app to choose its screen). */
export function primeHome(key: string, data: HomeData): void {
  generation += 1;
  inflight = null;
  set({ key, generation, state: { status: "ready", data }, pending: false });
}

/** Drop the cached answer and any request in flight: the next reader loads afresh. Call it whenever the session or what it may see changes. */
export function invalidateHome(): void {
  generation += 1;
  inflight = null;
  set(null);
}

/** Forget everything; for tests. */
export function resetHomeStore(): void {
  invalidateHome();
  failures = 0;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Return the cached entry of `key`, or null when the cache holds nothing for it. */
export function useHomeEntry(key: string): HomeEntry | null {
  const current = useSyncExternalStore(subscribe, () => entry);
  return current?.key === key ? current : null;
}
