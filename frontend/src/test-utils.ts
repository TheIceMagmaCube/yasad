import { vi } from "vitest";

type Route = { status: number; body?: unknown };
export type Routes = Record<string, Route | Route[]>;

/**
 * Replace fetch with canned responses keyed by "METHOD /path".
 *
 * A list of responses is consumed in order, the last one repeating. Return the mock to inspect calls.
 */
export function mockApi(routes: Routes) {
  const queues = new Map(Object.entries(routes).map(([key, value]) => [key, Array.isArray(value) ? [...value] : [value]]));
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${path}`;
    const queue = queues.get(key);
    if (!queue) throw new Error(`Unexpected request: ${key}`);
    const route = queue.length > 1 ? queue.shift()! : queue[0]!;
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), { status: route.status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Return the JSON body sent with the n-th call of the fetch mock. */
export function sentBody(fetchMock: ReturnType<typeof mockApi>, n: number): unknown {
  return JSON.parse(String(fetchMock.mock.calls[n]![1]!.body));
}
