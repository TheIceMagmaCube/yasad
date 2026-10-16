import { useCallback, useEffect, useRef, useState } from "react";

import { api, type HomeData } from "@/api";

export type HomeState =
  | { status: "loading" }
  | { status: "ready"; data: HomeData }
  /** `attempt` changes on every failure, so the error can be announced again. */
  | { status: "error"; error: unknown; attempt: number };

/**
 * Load the home page data. With `initial` (the anonymous home, already fetched), nothing is requested.
 *
 * `retry` keeps the current state until the new answer arrives and ignores calls while one is running;
 * `retrying` says one is. Answers arriving after unmount are dropped.
 */
export function useHomeData(initial?: HomeData): { state: HomeState; retry: () => void; retrying: boolean } {
  const [state, setState] = useState<HomeState>(initial ? { status: "ready", data: initial } : { status: "loading" });
  const [retrying, setRetrying] = useState(false);
  const mounted = useRef(true);
  const running = useRef(false);
  const failures = useRef(0);

  const load = useCallback(() => {
    if (running.current) return;
    running.current = true;
    api
      .home()
      .then(
        (data) => mounted.current && setState({ status: "ready", data }),
        (error: unknown) => {
          failures.current += 1;
          if (mounted.current) setState({ status: "error", error, attempt: failures.current });
        },
      )
      .finally(() => {
        running.current = false;
        if (mounted.current) setRetrying(false);
      });
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!initial) load();
    return () => {
      mounted.current = false;
    };
    // Loaded once per mount; a new `initial` comes with a new page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = useCallback(() => {
    if (running.current) return;
    setRetrying(true);
    load();
  }, [load]);

  return { state, retry, retrying };
}
