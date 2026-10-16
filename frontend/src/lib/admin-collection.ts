import { useCallback, useEffect, useRef, useState } from "react";

type State<T> =
  | { status: "loading" }
  | { status: "error"; attempt: number; retrying: boolean }
  | { status: "ready"; data: T; refreshFailures: number };

export type AdminCollection<T> = {
  status: "loading" | "error" | "ready";
  /** The loaded data; null while loading and after a failed load, never an empty stand-in. */
  data: T | null;
  /** Number of failed loads in a row, to key the load error so it is announced again. */
  attempt: number;
  /** Whether a retry after a failed load is running. */
  retrying: boolean;
  /** Load again after a failed load. */
  retry: () => void;
  /** Reload while the list stays shown; resolve with the new data once shown, or null when it failed or was overtaken. */
  refresh: () => Promise<T | null>;
  /** Number of failed refreshes in a row, 0 after a successful one: the list shown may be out of date. */
  refreshFailures: number;
  /** Change the data in place, after a write the server confirmed; a refresh already running is ignored. */
  setData: (update: (data: T) => T) => void;
};

/**
 * Load the data of an administration list once, with retry after a failure and silent refreshes after actions.
 * Only the latest request applies: a slower earlier one, or one started before {@link AdminCollection.setData},
 * is ignored.
 */
export function useAdminCollection<T>(load: () => Promise<T>): AdminCollection<T> {
  const [state, setState] = useState<State<T>>({ status: "loading" });
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const latest = useRef(0);
  const mounted = useRef(true);

  /** Load, then apply the result if no later request or local change came first; return the data applied. */
  const run = useCallback(async (apply: (result: { ok: true; data: T } | { ok: false }) => void): Promise<T | null> => {
    const n = ++latest.current;
    let result: { ok: true; data: T } | { ok: false };
    try {
      result = { ok: true, data: await loadRef.current() };
    } catch {
      result = { ok: false };
    }
    if (!mounted.current || n !== latest.current) return null;
    apply(result);
    return result.ok ? result.data : null;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void run((result) => setState(result.ok ? { status: "ready", data: result.data, refreshFailures: 0 } : { status: "error", attempt: 1, retrying: false }));
    return () => {
      mounted.current = false;
    };
  }, [run]);

  const retry = useCallback(() => {
    setState((prev) => (prev.status === "error" ? { ...prev, retrying: true } : prev));
    void run((result) =>
      setState((prev) =>
        result.ok
          ? { status: "ready", data: result.data, refreshFailures: 0 }
          : { status: "error", attempt: (prev.status === "error" ? prev.attempt : 0) + 1, retrying: false },
      ),
    );
  }, [run]);

  const refresh = useCallback(
    () =>
      run((result) =>
        setState((prev) => {
          if (prev.status !== "ready") return result.ok ? { status: "ready", data: result.data, refreshFailures: 0 } : prev;
          return result.ok ? { status: "ready", data: result.data, refreshFailures: 0 } : { ...prev, refreshFailures: prev.refreshFailures + 1 };
        }),
      ),
    [run],
  );

  const setData = useCallback((update: (data: T) => T) => {
    latest.current++;
    setState((prev) => (prev.status === "ready" ? { ...prev, data: update(prev.data) } : prev));
  }, []);

  return {
    status: state.status,
    data: state.status === "ready" ? state.data : null,
    attempt: state.status === "error" ? state.attempt : 0,
    retrying: state.status === "error" && state.retrying,
    retry,
    refresh,
    refreshFailures: state.status === "ready" ? state.refreshFailures : 0,
    setData,
  };
}
