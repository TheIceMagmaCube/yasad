import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useGestureQueue } from "./pin-queue";

/** Return a promise the test settles by hand. */
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useGestureQueue", () => {
  it("sends one gesture at a time, in order", async () => {
    const { result } = renderHook(() => useGestureQueue());
    const first = deferred();
    const calls: string[] = [];
    const runA = vi.fn(() => {
      calls.push("a");
      return first.promise;
    });
    const runB = vi.fn(async () => {
      calls.push("b");
    });
    act(() => {
      result.current.enqueue("a", runA);
      result.current.enqueue("b", runB);
    });
    expect(runA).toHaveBeenCalledTimes(1);
    expect(runB).not.toHaveBeenCalled();
    await act(async () => first.resolve());
    await vi.waitFor(() => expect(runB).toHaveBeenCalledTimes(1));
    expect(calls).toEqual(["a", "b"]);
  });

  it("keeps a button pending while queued or in flight", async () => {
    const { result } = renderHook(() => useGestureQueue());
    const first = deferred();
    const second = deferred();
    act(() => {
      result.current.enqueue("a", () => first.promise);
      result.current.enqueue("b", () => second.promise);
    });
    expect(result.current.isPending("a")).toBe(true);
    expect(result.current.isPending("b")).toBe(true);
    expect(result.current.isPending("c")).toBe(false);
    await act(async () => first.resolve());
    expect(result.current.isPending("a")).toBe(false);
    expect(result.current.isPending("b")).toBe(true);
    await act(async () => second.resolve());
    expect(result.current.isPending("b")).toBe(false);
  });

  it("goes on after a failed gesture", async () => {
    const { result } = renderHook(() => useGestureQueue());
    const runB = vi.fn(async () => {});
    act(() => {
      result.current.enqueue("a", () => Promise.reject(new Error("network")));
      result.current.enqueue("b", runB);
    });
    await vi.waitFor(() => expect(runB).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(result.current.isPending("a")).toBe(false));
    await vi.waitFor(() => expect(result.current.isPending("b")).toBe(false));
  });
});
