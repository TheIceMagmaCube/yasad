import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DetailColumns, listHref, rememberRow, useQueryState, useRestoreRow } from "./DetailPage";

afterEach(cleanup);

describe("useQueryState", () => {
  it("reads a list setting from the address and replaces the entry when it changes, adding no history", () => {
    history.replaceState(null, "", "/things?q=bob&group=g1");
    const length = history.length;
    const { result } = renderHook(() => useQueryState("q"));
    expect(result.current[0]).toBe("bob");
    act(() => result.current[1]("carol"));
    expect(location.search).toBe("?q=carol&group=g1");
    act(() => result.current[1](""));
    expect(location.search).toBe("?group=g1");
    expect(history.length).toBe(length);
  });
});

describe("rememberRow and useRestoreRow", () => {
  it("links back to the list with its filter, and focuses the row that opened the item once the list shows", () => {
    history.replaceState(null, "", "/things?q=bo");
    rememberRow("/things", "row-b");
    expect(listHref("/things")).toBe("/things?q=bo");

    function List({ ready }: { ready: boolean }) {
      useRestoreRow("/things", ready);
      return ready ? <a id="row-b" href="/things/b">Bob</a> : null;
    }
    const { rerender } = render(<List ready={false} />);
    rerender(<List ready />);
    expect(screen.getByRole("link", { name: "Bob" })).toHaveFocus();

    // Once: a later visit of the list leaves the focus to the page.
    (document.activeElement as HTMLElement).blur();
    cleanup();
    render(<List ready />);
    expect(screen.getByRole("link", { name: "Bob" })).not.toHaveFocus();
  });

  it("returns the bare address of a list never left", () => {
    expect(listHref("/elsewhere")).toBe("/elsewhere");
  });
});

describe("DetailColumns", () => {
  it("keeps an item page at most 1024 px wide in the wide app column", () => {
    const { container } = render(<DetailColumns main={<p>main</p>} side={<p>side</p>} />);
    expect(container.firstElementChild).toHaveClass("max-w-5xl");
  });
});
