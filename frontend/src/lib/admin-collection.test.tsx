import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useAdminCollection } from "./admin-collection";

/** Return a promise and the functions settling it. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useAdminCollection", () => {
  it("loads once, then shows the data", async () => {
    const load = vi.fn(async () => ["a"]);
    const { result } = renderHook(() => useAdminCollection(load));
    expect(result.current.status).toBe("loading");
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.data).toEqual(["a"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps no data after a failed load, counts the failures, and retries", async () => {
    const load = vi.fn<() => Promise<string[]>>().mockRejectedValueOnce(new Error("down")).mockRejectedValueOnce(new Error("down")).mockResolvedValue(["a"]);
    const { result } = renderHook(() => useAdminCollection(load));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
    expect(result.current.attempt).toBe(1);
    act(() => result.current.retry());
    expect(result.current.retrying).toBe(true);
    await waitFor(() => expect(result.current.attempt).toBe(2));
    expect(result.current.retrying).toBe(false);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.data).toEqual(["a"]);
  });

  it("keeps the list shown when a refresh fails, and counts the failure until one succeeds", async () => {
    const load = vi.fn<() => Promise<string[]>>().mockResolvedValueOnce(["a"]).mockRejectedValueOnce(new Error("down")).mockResolvedValue(["b"]);
    const { result } = renderHook(() => useAdminCollection(load));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(() => result.current.refresh());
    expect(result.current.data).toEqual(["a"]);
    expect(result.current.refreshFailures).toBe(1);
    let fresh: string[] | null = null;
    await act(async () => {
      fresh = await result.current.refresh();
    });
    expect(fresh).toEqual(["b"]);
    expect(result.current.data).toEqual(["b"]);
    expect(result.current.refreshFailures).toBe(0);
  });

  it("applies only the latest request, and ignores one started before a local change", async () => {
    const slow = deferred<string[]>();
    const load = vi.fn<() => Promise<string[]>>().mockResolvedValueOnce(["a"]).mockReturnValueOnce(slow.promise).mockResolvedValue(["c"]);
    const { result } = renderHook(() => useAdminCollection(load));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    let stale!: Promise<string[] | null>;
    act(() => {
      stale = result.current.refresh();
    });
    act(() => result.current.setData((list) => [...list, "b"]));
    let overtaken: string[] | null = ["unset"];
    await act(async () => {
      slow.resolve(["old"]);
      overtaken = await stale;
    });
    expect(overtaken).toBeNull();
    expect(result.current.data).toEqual(["a", "b"]);
    await act(() => result.current.refresh());
    expect(result.current.data).toEqual(["c"]);
  });
});
