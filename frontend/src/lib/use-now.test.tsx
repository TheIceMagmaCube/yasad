import { act, cleanup, render, screen } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useNow } from "./use-now";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const START = Date.parse("2026-10-19T12:00:00.000Z");

function Clock({ name }: { name: string }) {
  return <p data-testid={name}>{useNow(60_000) - START}</p>;
}

/** Read the clock during a render that throws, so it is never committed and never subscribes. */
function Abandoned(): ReactNode {
  useNow(60_000);
  throw new Error("abandoned render");
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

describe("useNow", () => {
  it("moves every interval, the same instant for every component, on one timer stopped with the last of them", () => {
    vi.useFakeTimers({ now: START });
    const { unmount } = render(
      <>
        <Clock name="a" />
        <Clock name="b" />
      </>,
    );
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByTestId("a")).toHaveTextContent(/^0$/);
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByTestId("a")).toHaveTextContent(/^60000$/);
    expect(screen.getByTestId("b")).toHaveTextContent(/^60000$/);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts from the time it is mounted at, not from a clock left by a render that never mounted", () => {
    vi.useFakeTimers({ now: START });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <Boundary>
        <Abandoned />
      </Boundary>,
    );
    quiet.mockRestore();
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(START + 5 * 60_000);
    render(<Clock name="a" />);
    expect(screen.getByTestId("a")).toHaveTextContent(/^300000$/);
  });
});
