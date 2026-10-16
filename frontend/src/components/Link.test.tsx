import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Link } from "./Link";

/** Click the element and return true when the browser would follow the link; the following itself is cancelled, jsdom cannot load pages. */
function clickFollows(element: Element, init?: MouseEventInit): boolean {
  let follows = false;
  const listener = (e: Event) => {
    follows = !e.defaultPrevented;
    e.preventDefault();
  };
  document.addEventListener("click", listener);
  fireEvent.click(element, init);
  document.removeEventListener("click", listener);
  return follows;
}

afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
});

describe("Link", () => {
  it("renders a real link and navigates in the app on a plain click", () => {
    render(<Link href="/admin/users?x=1">Users</Link>);
    const link = screen.getByRole("link", { name: "Users" });
    expect(link).toHaveAttribute("href", "/admin/users?x=1");
    expect(clickFollows(link)).toBe(false);
    expect(location.pathname + location.search).toBe("/admin/users?x=1");
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])(
    "leaves a modified click to the browser: %o",
    (init) => {
      render(<Link href="/admin/users">Users</Link>);
      expect(clickFollows(screen.getByRole("link"), init)).toBe(true);
      expect(location.pathname).toBe("/");
    },
  );

  it("leaves external, new-tab and download links to the browser", () => {
    render(
      <>
        <Link href="https://example.invalid/">External</Link>
        <Link href="/admin" target="_blank">
          New tab
        </Link>
        <Link href="/api/admin/catalog" download="catalog.yaml">
          Download
        </Link>
      </>,
    );
    for (const name of ["External", "New tab", "Download"]) {
      expect(clickFollows(screen.getByRole("link", { name }))).toBe(true);
    }
    expect(location.pathname).toBe("/");
  });

  it("runs its own click handler first and respects preventDefault", () => {
    render(
      <Link href="/admin" onClick={(e) => e.preventDefault()}>
        Admin
      </Link>,
    );
    expect(clickFollows(screen.getByRole("link"))).toBe(false);
    expect(location.pathname).toBe("/");
  });
});
