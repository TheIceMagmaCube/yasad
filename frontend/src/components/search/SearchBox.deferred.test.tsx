import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { HomeData } from "@/api";
import { primeHome, resetHomeStore } from "@/lib/home-store";
import { getStatus, mockApi, renderWithProviders } from "@/test-utils";

import { SearchBox, STATUS_DELAY } from "./SearchBox";

/** Value the deferred query is held at, as on a slow device before React renders the deferred update; null lets it follow. */
const lag = vi.hoisted(() => ({ value: null as string | null }));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useDeferredValue: <T,>(value: T): T => (lag.value === null ? value : (lag.value as T)) };
});

const DATA: HomeData = {
  signedIn: true,
  categories: [{ id: "everyday", title: "Everyday", links: [{ id: "mail", title: "Mail", description: "", url: "https://mail.example.invalid/", icon: null, keywords: [] }] }],
  empty: null,
  pins: [],
};

afterEach(() => {
  lag.value = null;
  vi.useRealTimers();
  resetHomeStore();
});

it("says nothing about matches while the results are still for an older query", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  primeHome("user:ada", DATA);
  mockApi({ "GET /api/home": { status: 200, body: DATA } });
  renderWithProviders(<SearchBox homeKey="user:ada" />);
  const input = screen.getByRole("combobox");
  act(() => input.focus());
  lag.value = "";
  fireEvent.change(input, { target: { value: "m" } });
  act(() => vi.advanceTimersByTime(STATUS_DELAY + 10));
  expect(screen.queryByText(/No link matches/)).toBeNull();
  expect(getStatus()).toBeEmptyDOMElement();
  expect(screen.getByRole("listbox", { hidden: true }).parentElement).not.toBeVisible();

  lag.value = null;
  fireEvent.change(input, { target: { value: "ma" } });
  expect(screen.getByRole("option", { name: /^Mail/ })).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(STATUS_DELAY + 10));
  expect(getStatus()).not.toBeEmptyDOMElement();
});
