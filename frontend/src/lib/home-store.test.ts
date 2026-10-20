import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HomeData } from "@/api";

import { homeKey, invalidateHome, loadHome, onViewerChanged, primeHome, setHomePins, useHomeEntry } from "./home-store";

const data = (title: string): HomeData => ({
  signedIn: true,
  categories: [{ id: "c", title, links: [] }],
  empty: null,
  pins: [],
});

/** Replace fetch with one whose answers the test releases, in call order. */
function controlledFetch() {
  const pending: ((body: HomeData) => void)[] = [];
  const fetchMock = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        pending.push((body) => resolve(new Response(JSON.stringify(body), { status: 200 })));
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, release: (n: number, body: HomeData) => act(async () => pending[n]!(body)) };
}

afterEach(() => vi.unstubAllGlobals());

describe("home store", () => {
  it("keys entries by viewer", () => {
    expect(homeKey(null)).toBe("anonymous");
    expect(homeKey({ id: "ada" })).toBe("user:ada");
  });

  it("deduplicates requests in flight", async () => {
    const { fetchMock, release } = controlledFetch();
    const { result } = renderHook(() => useHomeEntry("user:ada"));
    act(() => {
      loadHome("user:ada");
      loadHome("user:ada");
      loadHome("user:ada", { reset: true });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current?.state.status).toBe("loading");
    await release(0, data("A"));
    await vi.waitFor(() => expect(result.current?.state).toEqual({ status: "ready", data: data("A") }));
    act(() => loadHome("user:ada"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // A refresh keeps the current data until the answer arrives.
    expect(result.current?.state.status).toBe("ready");
    expect(result.current?.pending).toBe(true);
  });

  it("empties the entry when the key changes, and only shows data to its own key", async () => {
    const { release } = controlledFetch();
    act(() => primeHome("user:ada", data("Ada's")));
    const ada = renderHook(() => useHomeEntry("user:ada"));
    const bob = renderHook(() => useHomeEntry("user:bob"));
    expect(ada.result.current?.state.status).toBe("ready");
    expect(bob.result.current).toBeNull();
    act(() => loadHome("user:bob"));
    expect(ada.result.current).toBeNull();
    expect(bob.result.current?.state.status).toBe("loading");
    await release(0, data("Bob's"));
    await vi.waitFor(() => expect(bob.result.current?.state).toEqual({ status: "ready", data: data("Bob's") }));
  });

  it("ignores a late answer after a key change", async () => {
    const { release } = controlledFetch();
    const { result } = renderHook(() => useHomeEntry("user:bob"));
    act(() => loadHome("user:ada"));
    act(() => loadHome("user:bob"));
    await release(1, data("Bob's"));
    await vi.waitFor(() => expect(result.current?.state.status).toBe("ready"));
    await release(0, data("Ada's"));
    await act(async () => {});
    expect(result.current?.state).toEqual({ status: "ready", data: data("Bob's") });
  });

  it("ignores a late answer after invalidateHome, even for the same key", async () => {
    const { fetchMock, release } = controlledFetch();
    const { result } = renderHook(() => useHomeEntry("user:ada"));
    act(() => loadHome("user:ada"));
    act(() => invalidateHome());
    expect(result.current).toBeNull();
    await release(0, data("stale"));
    await act(async () => {});
    expect(result.current).toBeNull();
    act(() => loadHome("user:ada"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await release(1, data("fresh"));
    await vi.waitFor(() => expect(result.current?.state).toEqual({ status: "ready", data: data("fresh") }));
  });

  it("stores a primed answer without fetching", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useHomeEntry("anonymous"));
    const pub = { ...data("Public"), signedIn: false };
    act(() => void primeHome("anonymous", pub));
    expect(result.current?.state).toEqual({ status: "ready", data: pub });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records failures with a new attempt number each time", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { code: "internal_error", message: "" } }), { status: 500 })),
    );
    const { result } = renderHook(() => useHomeEntry("user:ada"));
    act(() => loadHome("user:ada"));
    await vi.waitFor(() => expect(result.current?.state).toMatchObject({ status: "error", attempt: 1 }));
    act(() => loadHome("user:ada"));
    expect(result.current?.state.status).toBe("error");
    await vi.waitFor(() => expect(result.current?.state).toMatchObject({ status: "error", attempt: 2 }));
    expect(result.current?.pending).toBe(false);
  });

  it("drops an answer for another viewer and reports it", async () => {
    const { release } = controlledFetch();
    const changed = vi.fn();
    const stop = onViewerChanged(changed);
    const anonymous = renderHook(() => useHomeEntry("anonymous"));
    act(() => void primeHome("anonymous", { ...data("Public"), signedIn: false }));
    // Someone signed in in another tab: the anonymous refetch comes back signed in.
    act(() => loadHome("anonymous"));
    await release(0, data("Private"));
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(anonymous.result.current).toBeNull();

    // And the other way round: a signed-in key gets an anonymous answer.
    const ada = renderHook(() => useHomeEntry("user:ada"));
    act(() => loadHome("user:ada"));
    await release(1, { ...data("Public"), signedIn: false });
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
    expect(ada.result.current).toBeNull();
    stop();
  });

  it("refuses to prime an answer for another viewer", () => {
    const { result } = renderHook(() => useHomeEntry("anonymous"));
    let stored = true;
    act(() => {
      stored = primeHome("anonymous", data("Private"));
    });
    expect(stored).toBe(false);
    expect(result.current).toBeNull();
  });
  it("setHomePins patches the ready entry of the same generation", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useHomeEntry("user:ada"));
    act(() => void primeHome("user:ada", { ...data("A"), pins: ["a"] }));
    const gen = result.current!.generation;
    let patched = false;
    act(() => {
      patched = setHomePins("user:ada", gen, ["b", "a"]);
    });
    expect(patched).toBe(true);
    expect(result.current?.state).toEqual({ status: "ready", data: { ...data("A"), pins: ["b", "a"] } });
    expect(result.current?.generation).toBe(gen);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("setHomePins ignores a stale generation and reloads without skeleton", async () => {
    const { fetchMock, release } = controlledFetch();
    const statuses: string[] = [];
    const { result } = renderHook(() => {
      const current = useHomeEntry("user:ada");
      if (current) statuses.push(current.state.status);
      return current;
    });
    act(() => void primeHome("user:ada", { ...data("A"), pins: ["a"] }));
    const oldGen = result.current!.generation;
    // The session changed and the home was read again before the gesture's answer came back.
    act(() => {
      invalidateHome();
      loadHome("user:ada");
    });
    await release(0, { ...data("A"), pins: ["a"] });
    await vi.waitFor(() => expect(result.current?.state.status).toBe("ready"));
    const readyFrom = statuses.length - 1;

    let patched = true;
    act(() => {
      patched = setHomePins("user:ada", oldGen, ["x"]);
    });
    expect(patched).toBe(false);
    expect(result.current?.state).toEqual({ status: "ready", data: { ...data("A"), pins: ["a"] } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await release(1, { ...data("A"), pins: ["x", "a"] });
    await vi.waitFor(() => expect(result.current?.state).toEqual({ status: "ready", data: { ...data("A"), pins: ["x", "a"] } }));
    expect(statuses.slice(readyFrom)).not.toContain("loading");
  });

  it("setHomePins for another viewer leaves the entry alone", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useHomeEntry("anonymous"));
    const pub = { ...data("Public"), signedIn: false };
    act(() => void primeHome("anonymous", pub));
    const gen = result.current!.generation;
    let patched = true;
    act(() => {
      patched = setHomePins("user:b", gen, ["x"]);
    });
    expect(patched).toBe(false);
    expect(result.current?.key).toBe("anonymous");
    expect(result.current?.state).toEqual({ status: "ready", data: pub });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
