import "@testing-library/jest-dom/vitest";

import { afterEach, vi } from "vitest";

import { resetHomeStore } from "./lib/home-store";

// jsdom has no matchMedia; tests run with a light system preference unless they stub it.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
});

// jsdom does not lay out, so it has no scrollIntoView; the search list calls it on every move.
Element.prototype.scrollIntoView = vi.fn();

afterEach(() => {
  localStorage.clear();
  resetHomeStore();
});
