import { useSyncExternalStore } from "react";

/** Current location as the app sees it; `navigations` counts pushes and history moves, not replacements. */
type RouterState = { path: string; navigations: number };

let state: RouterState = { path: location.pathname, navigations: 0 };
const listeners = new Set<() => void>();

/** Notify the subscribers, counting the change as a navigation unless it only replaced the entry. */
function update(counted: boolean): void {
  state = { path: location.pathname, navigations: state.navigations + (counted ? 1 : 0) };
  for (const listener of listeners) listener();
}

const onPopState = () => update(true);

/** Subscribe to location changes; listen to the browser history while at least one subscriber exists. */
function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("popstate", onPopState);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("popstate", onPopState);
  };
}

/** Return the router state, refreshed when the history was changed outside the router. */
function snapshot(): RouterState {
  if (state.path !== location.pathname) state = { ...state, path: location.pathname };
  return state;
}

/** Go to a same-origin path without reloading the page; `replace` rewrites the current history entry instead. */
export function navigate(path: string, { replace = false }: { replace?: boolean } = {}): void {
  const target = new URL(path, location.href);
  const same = target.href === location.href;
  if (replace || same) history.replaceState(null, "", target.href);
  else history.pushState(null, "", target.href);
  update(!replace);
}

/** Return the current path name. */
export function usePath(): string {
  return useSyncExternalStore(subscribe, snapshot).path;
}

/** Return the number of client-side navigations since the page loaded. */
export function useNavigations(): number {
  return useSyncExternalStore(subscribe, snapshot).navigations;
}

/** Return the path with any trailing slash removed, the root excepted. */
export function normalizePath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}
