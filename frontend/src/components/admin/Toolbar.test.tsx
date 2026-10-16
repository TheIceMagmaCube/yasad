import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getAnnouncer, renderWithProviders } from "../../test-utils";
import { Toolbar } from "./Toolbar";

afterEach(cleanup);

function Harness({ onPageEscape, status = "" }: { onPageEscape: () => void; status?: string }) {
  const [query, setQuery] = useState("");
  const shown = query ? 1 : 3;
  return (
    <div onKeyDown={(e) => e.key === "Escape" && !e.defaultPrevented && onPageEscape()}>
      <Toolbar filterId="f" filterLabel="Filter users" query={query} onQueryChange={setQuery} count={query ? `${shown} of 3 users` : "3 users"} status={status} />
    </div>
  );
}

describe("Toolbar", () => {
  it("clears a filter holding text on Escape, and lets Escape in an empty filter go on to the page", async () => {
    const onPageEscape = vi.fn();
    renderWithProviders(<Harness onPageEscape={onPageEscape} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Filter users"), "bo");
    expect(screen.getByText("1 of 3 users")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByLabelText("Filter users")).toHaveValue("");
    expect(onPageEscape).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onPageEscape).toHaveBeenCalledTimes(1);
  });

  it("reads the count once typing stops, and not on the first render", async () => {
    vi.useFakeTimers();
    try {
      renderWithProviders(<Harness onPageEscape={() => {}} />);
      act(() => vi.advanceTimersByTime(1000));
      expect(getAnnouncer()).toHaveTextContent("");
      fireEvent.change(screen.getByLabelText("Filter users"), { target: { value: "b" } });
      act(() => vi.advanceTimersByTime(400));
      expect(getAnnouncer()).toHaveTextContent("");
      act(() => vi.advanceTimersByTime(200));
      expect(getAnnouncer()).toHaveTextContent("1 of 3 users");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the status line with its text, and keeps it mounted when empty", () => {
    const { rerender } = renderWithProviders(<Harness onPageEscape={() => {}} />);
    const line = document.querySelector('[data-slot="toolbar-status"]')!;
    expect(line).toBeEmptyDOMElement();
    rerender(<Harness onPageEscape={() => {}} status="Bob updated." />);
    expect(document.querySelector('[data-slot="toolbar-status"]')).toBe(line);
    expect(line).toHaveTextContent("Bob updated.");
    expect(line).not.toHaveAttribute("role");
  });
});
