import { render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { vi } from "vitest";

import { LocaleProvider } from "./i18n/LocaleProvider";
import { AnnouncerProvider } from "./lib/announcer";
import { ThemeProvider } from "./theme/ThemeProvider";

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

/** Wrap a tree in the language, theme and announcer providers, as the app does. */
function Providers({ children }: { children: ReactNode }) {
  return createElement(LocaleProvider, {
    defaultLanguage: "en",
    children: createElement(ThemeProvider, { instanceTheme: "default", children: createElement(AnnouncerProvider, { children }) }),
  });
}

/** Render inside the language, theme and announcer providers, which `rerender` keeps. */
export function renderWithProviders(ui: ReactNode) {
  return render(ui, { wrapper: Providers });
}

/** Return the one status region of the component under test, the app's announcer left out. */
export function getStatus(): HTMLElement {
  const regions = screen.getAllByRole("status").filter((el) => el.dataset.slot !== "announcer");
  if (regions.length !== 1) throw new Error(`Expected one status region, found ${regions.length}`);
  return regions[0]!;
}

/** Wait for the one status region of the component under test, the app's announcer left out. */
export function findStatus(): Promise<HTMLElement> {
  return waitFor(getStatus);
}

/** Return the app's announcer region. */
export function getAnnouncer(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-slot="announcer"]')!;
}
