import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getAnnouncer, renderWithProviders } from "../../test-utils";
import { PendingButton } from "./PendingButton";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PendingButton", () => {
  it("shows its progress label, keeps the focus and ignores clicks while pending", () => {
    const onClick = vi.fn();
    render(
      <PendingButton pending pendingLabel="Deleting…" onClick={onClick}>
        Delete
      </PendingButton>,
    );
    const button = screen.getByRole("button", { name: "Deleting…" });
    button.focus();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
  });

  it("ignores a second click that comes before the parent marked it pending", () => {
    const onClick = vi.fn();
    render(
      <PendingButton pending={false} pendingLabel="Saving…" onClick={onClick}>
        Save
      </PendingButton>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("accepts a new click once a click that started nothing is over", async () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    render(
      <PendingButton pending={false} pendingLabel="Saving…" onClick={onClick}>
        Save
      </PendingButton>,
    );
    fireEvent.click(screen.getByRole("button"));
    act(() => vi.advanceTimersByTime(0));
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("accepts the next click as soon as the first one re-rendered it idle, before any timer runs", () => {
    // A wizard's Next becomes Create on the same element; a fast key press on it must not hit the double-click guard.
    vi.useFakeTimers();
    function Wizard({ onStep }: { onStep: (step: number) => void }) {
      const [step, setStep] = useState(0);
      return (
        <PendingButton
          pending={false}
          pendingLabel="Creating…"
          onClick={() => {
            onStep(step);
            setStep(step + 1);
          }}
        >
          {step === 0 ? "Next" : "Create"}
        </PendingButton>
      );
    }
    const onStep = vi.fn();
    render(<Wizard onStep={onStep} />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onStep.mock.calls).toEqual([[0], [1]]);
  });

  it("accepts a new click once the pending action is over", () => {
    function Saver({ onClick }: { onClick: () => void }) {
      const [pending, setPending] = useState(false);
      return (
        <>
          <PendingButton
            pending={pending}
            pendingLabel="Saving…"
            onClick={() => {
              onClick();
              setPending(true);
            }}
          >
            Save
          </PendingButton>
          <button type="button" onClick={() => setPending(false)}>
            Finish
          </button>
        </>
      );
    }
    const onClick = vi.fn();
    render(<Saver onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("announces the progress label only when the wait lasts over 400 ms", () => {
    vi.useFakeTimers();
    const { rerender } = renderWithProviders(
      <PendingButton pending pendingLabel="Importing…">
        Import
      </PendingButton>,
    );
    act(() => vi.advanceTimersByTime(399));
    expect(getAnnouncer()).toHaveTextContent("");
    act(() => vi.advanceTimersByTime(1));
    expect(getAnnouncer()).toHaveTextContent("Importing…");
    rerender(
      <PendingButton pending={false} pendingLabel="Importing…">
        Import
      </PendingButton>,
    );
  });
});
