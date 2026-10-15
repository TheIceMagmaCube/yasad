import "@testing-library/jest-dom/vitest";

import { afterEach, vi } from "vitest";

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

afterEach(() => localStorage.clear());
