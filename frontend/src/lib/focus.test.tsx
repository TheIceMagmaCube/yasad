import { act, cleanup, render, screen } from "@testing-library/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { claimFocus, focusById, focusPage, useFocusOnNavigation, useFocusOnViewChange, usePageHeading } from "./focus";
import { navigate, usePath } from "./router";

afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
});

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

function Heading({ title, loading = false }: { title: string; loading?: boolean }) {
  const ref = useRef<HTMLHeadingElement>(null);
  usePageHeading(ref);
  return (
    <h1 ref={ref} tabIndex={-1} data-page-loading={loading ? "" : undefined}>
      {title}
    </h1>
  );
}

/** A page loading after the navigation: a loading heading, then its own heading in another element. */
function Loaded({ ready }: { ready: Promise<void> }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => void ready.then(() => setLoaded(true)), [ready]);
  return loaded ? (
    <section>
      <Heading title="Jira" />
      <button>Save</button>
    </section>
  ) : (
    <Heading title="Loading" loading />
  );
}

function Routed({ ready }: { ready: Promise<void> }) {
  useFocusOnNavigation();
  const path = usePath();
  return <main id="content">{path === "/links/jira" ? <Loaded ready={ready} /> : <Heading title="Preview" />}</main>;
}

describe("usePageHeading", () => {
  it("takes the page focus over from the loading heading of a page opened by a navigation", async () => {
    let finish!: () => void;
    const ready = new Promise<void>((resolve) => {
      finish = resolve;
    });
    render(<Routed ready={ready} />);
    act(() => navigate("/links/jira"));
    expect(screen.getByRole("heading", { name: "Loading" })).toHaveFocus();
    await act(async () => finish());
    expect(screen.getByRole("heading", { name: "Jira" })).toHaveFocus();
  });

  it("leaves the focus alone when the heading replaced was not a loading one", () => {
    const { rerender } = render(<Page />);
    focusPage();
    rerender(
      <main id="content">
        <Heading title="Jira" />
      </main>,
    );
    expect(document.body).toHaveFocus();
  });

  it("leaves the focus alone once it went elsewhere after the page focus", async () => {
    let finish!: () => void;
    const ready = new Promise<void>((resolve) => {
      finish = resolve;
    });
    render(<Routed ready={ready} />);
    act(() => navigate("/links/jira"));
    const other = document.createElement("button");
    document.body.append(other);
    other.focus();
    // A click on the page background: the focus goes back to the body.
    other.blur();
    await act(async () => finish());
    expect(document.body).toHaveFocus();
    other.remove();
  });
});
