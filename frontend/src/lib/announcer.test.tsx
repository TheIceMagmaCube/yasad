import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ANNOUNCEMENT_LIFETIME, AnnouncerProvider, useAnnounce, useAnnounceAfter, useDebouncedStatus } from "./announcer";
import { navigate } from "./router";

/** Return the announcer region. */
const region = () => document.querySelector<HTMLElement>('[data-slot="announcer"]')!;

function Speaker({ text }: { text: string }) {
  const announce = useAnnounce();
  return (
    <button type="button" onClick={() => announce(text)}>
      Speak
    </button>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  history.replaceState(null, "", "/");
});

describe("AnnouncerProvider", () => {
  it("is one atomic status region without a redundant aria-live", () => {
    render(<AnnouncerProvider>content</AnnouncerProvider>);
    expect(screen.getByRole("status")).toBe(region());
    expect(region()).toHaveAttribute("aria-atomic", "true");
    expect(region()).not.toHaveAttribute("aria-live");
  });

  it("puts two identical announcements in two distinct nodes, so the text is read again", () => {
    render(
      <AnnouncerProvider>
        <Speaker text="Saved." />
      </AnnouncerProvider>,
    );
    act(() => screen.getByRole("button").click());
    const first = region().firstElementChild;
    expect(region()).toHaveTextContent("Saved.");
    act(() => screen.getByRole("button").click());
    expect(region()).toHaveTextContent("Saved.");
    expect(region().firstElementChild).not.toBe(first);
  });

  it("empties the region on navigation", () => {
    render(
      <AnnouncerProvider>
        <Speaker text="Saved." />
      </AnnouncerProvider>,
    );
    act(() => screen.getByRole("button").click());
    expect(region()).toHaveTextContent("Saved.");
    act(() => navigate("/elsewhere"));
    expect(region()).toHaveTextContent("");
  });

  it("empties the region a while after the last announcement", () => {
    render(
      <AnnouncerProvider>
        <Speaker text="Signing in…" />
      </AnnouncerProvider>,
    );
    act(() => screen.getByRole("button").click());
    act(() => vi.advanceTimersByTime(ANNOUNCEMENT_LIFETIME - 1000));
    act(() => screen.getByRole("button").click());
    act(() => vi.advanceTimersByTime(ANNOUNCEMENT_LIFETIME - 1));
    expect(region()).toHaveTextContent("Signing in…");
    act(() => vi.advanceTimersByTime(1));
    expect(region()).toHaveTextContent("");
  });

  it("does nothing outside a provider", () => {
    render(<Speaker text="Saved." />);
    expect(() => act(() => screen.getByRole("button").click())).not.toThrow();
  });
});

function Pending({ active }: { active: boolean }) {
  useAnnounceAfter(active, "Signing in…", 400);
  return null;
}

describe("useAnnounceAfter", () => {
  it("stays silent under the delay and announces after it", () => {
    const { rerender } = render(
      <AnnouncerProvider>
        <Pending active />
      </AnnouncerProvider>,
    );
    act(() => vi.advanceTimersByTime(399));
    expect(region()).toHaveTextContent("");
    act(() => vi.advanceTimersByTime(1));
    expect(region()).toHaveTextContent("Signing in…");

    rerender(
      <AnnouncerProvider>
        <Pending active={false} />
      </AnnouncerProvider>,
    );
  });

  it("announces nothing when the operation ends first", () => {
    const { rerender } = render(
      <AnnouncerProvider>
        <Pending active />
      </AnnouncerProvider>,
    );
    act(() => vi.advanceTimersByTime(200));
    rerender(
      <AnnouncerProvider>
        <Pending active={false} />
      </AnnouncerProvider>,
    );
    act(() => vi.advanceTimersByTime(1000));
    expect(region()).toHaveTextContent("");
  });
});

function Counter() {
  const [n, setN] = useState(0);
  useDebouncedStatus(n === 0 ? "" : `${n} results`);
  return (
    <button type="button" onClick={() => setN((x) => x + 1)}>
      Type
    </button>
  );
}

describe("useDebouncedStatus", () => {
  it("announces only the count that stays for 500 ms", () => {
    render(
      <AnnouncerProvider>
        <Counter />
      </AnnouncerProvider>,
    );
    act(() => screen.getByRole("button").click());
    act(() => vi.advanceTimersByTime(300));
    act(() => screen.getByRole("button").click());
    act(() => vi.advanceTimersByTime(499));
    expect(region()).toHaveTextContent("");
    act(() => vi.advanceTimersByTime(1));
    expect(region()).toHaveTextContent("2 results");
  });

  it("reads the same count again in a new node, and is emptied by a navigation", () => {
    function Same() {
      const [n, setN] = useState(0);
      useDebouncedStatus(n % 2 === 0 ? "" : "3 results");
      return (
        <button type="button" onClick={() => setN((x) => x + 1)}>
          Type
        </button>
      );
    }
    render(
      <AnnouncerProvider>
        <Same />
      </AnnouncerProvider>,
    );
    act(() => screen.getByRole("button").click());
    act(() => vi.advanceTimersByTime(500));
    const first = region().firstElementChild;
    act(() => screen.getByRole("button").click());
    act(() => screen.getByRole("button").click());
    act(() => vi.advanceTimersByTime(500));
    expect(region()).toHaveTextContent("3 results");
    expect(region().firstElementChild).not.toBe(first);
    act(() => navigate("/elsewhere"));
    expect(region()).toHaveTextContent("");
  });
});
