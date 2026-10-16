import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HomeData } from "@/api";

import { homeKey, invalidateHome, loadHome, primeHome, useHomeEntry } from "./home-store";

const data = (title: string): HomeData => ({
  signedIn: true,
  categories: [{ id: "c", title, links: [] }],
  empty: null,
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
    act(() => primeHome("anonymous", data("Public")));
    expect(result.current?.state).toEqual({ status: "ready", data: data("Public") });
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
});
