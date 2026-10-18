import { act, cleanup, render, screen } from "@testing-library/react";
import { type ReactNode, useEffect, useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { claimFocus, focusById, focusPage, useFocusOnViewChange } from "./focus";

afterEach(cleanup);

function Page({ children }: { children?: ReactNode }) {
  return (
    <main id="content" tabIndex={-1}>
      <h1 tabIndex={-1}>Groups</h1>
      {children}
    </main>
  );
}

describe("focusPage", () => {
  it("focuses the page heading", () => {
    render(<Page />);
    focusPage();
    expect(screen.getByRole("heading", { name: "Groups" })).toHaveFocus();
  });

  it("leaves the focus where a component of the same commit claimed it", () => {
    function Claimer() {
      const ref = useRef<HTMLButtonElement>(null);
      useEffect(() => {
        ref.current?.focus();
        claimFocus();
        focusPage();
      }, []);
      return <button ref={ref}>Retry</button>;
    }
    render(
      <Page>
        <Claimer />
      </Page>,
    );
    expect(screen.getByRole("button", { name: "Retry" })).toHaveFocus();
  });

  it("forgets the claim once the commit is over", async () => {
    render(<Page />);
    claimFocus();
    await Promise.resolve();
    focusPage();
    expect(screen.getByRole("heading", { name: "Groups" })).toHaveFocus();
  });
});

describe("focusById", () => {
  it("waits for the reload before looking for the element", async () => {
    const { rerender } = render(<Page />);
    let finish!: () => void;
    const reload = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const done = focusById("user-1-edit", reload);
    rerender(
      <Page>
        <button id="user-1-edit">Edit</button>
      </Page>,
    );
    finish();
    await act(() => done);
    expect(screen.getByRole("button", { name: "Edit" })).toHaveFocus();
  });

  it("focuses the first element still there among several", async () => {
    render(
      <Page>
        <button id="member-carol-remove">Remove Carol</button>
      </Page>,
    );
    await act(() => focusById(["member-dan-remove", "member-carol-remove", "picker"]));
    expect(screen.getByRole("button", { name: "Remove Carol" })).toHaveFocus();
  });

  it("falls back to the list filter, then to the heading, never to the body", async () => {
    const { rerender } = render(
      <Page>
        <input aria-label="Filter" data-focus-fallback="" />
      </Page>,
    );
    await act(() => focusById("gone"));
    expect(screen.getByLabelText("Filter")).toHaveFocus();

    rerender(<Page />);
    await act(() => focusById("gone", Promise.reject(new Error("reload failed"))));
    expect(screen.getByRole("heading", { name: "Groups" })).toHaveFocus();
  });
});

function Screen({ viewKey }: { viewKey: string }) {
  useFocusOnViewChange(viewKey);
  return <Page />;
}

describe("useFocusOnViewChange", () => {
  it("leaves the first view after loading alone, then focuses the heading on each change", () => {
    const { rerender } = render(<Screen viewKey="loading" />);
    rerender(<Screen viewKey="signIn" />);
    expect(document.body).toHaveFocus();
    rerender(<Screen viewKey="home:ada" />);
    expect(screen.getByRole("heading", { name: "Groups" })).toHaveFocus();
  });

  it("does not move the focus when the view stays the same", () => {
    const { rerender } = render(<Screen viewKey="home:ada" />);
    const other = document.createElement("button");
    document.body.append(other);
    other.focus();
    rerender(<Screen viewKey="home:ada" />);
    expect(other).toHaveFocus();
    other.remove();
  });
});
