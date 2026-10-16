import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { navigate, normalizePath, useNavigations, usePath } from "./router";

function Probe() {
  return (
    <p>
      {usePath()} {useNavigations()}
    </p>
  );
}

/** Return the rendered path and navigation count. */
function probe(): [string, number] {
  const [path, count] = screen.getByText(/^\//).textContent!.split(" ");
  return [path!, Number(count)];
}

afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
});

describe("router", () => {
  it("pushes a history entry and updates the path", () => {
    render(<Probe />);
    const [, before] = probe();
    const length = history.length;
    act(() => navigate("/admin/groups"));
    expect(location.pathname).toBe("/admin/groups");
    expect(history.length).toBe(length + 1);
    expect(probe()).toEqual(["/admin/groups", before + 1]);
  });

  it("replaces the entry without counting a navigation", () => {
    render(<Probe />);
    const [, before] = probe();
    const length = history.length;
    act(() => navigate("/admin", { replace: true }));
    expect(history.length).toBe(length);
    expect(probe()).toEqual(["/admin", before]);
  });

  it("follows the browser history on popstate", () => {
    render(<Probe />);
    const [, before] = probe();
    act(() => {
      history.pushState(null, "", "/elsewhere");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(probe()).toEqual(["/elsewhere", before + 1]);
  });

  it("does not count a fragment change as a navigation", () => {
    render(<Probe />);
    const [, before] = probe();
    act(() => {
      history.pushState(null, "", "/#content");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(probe()).toEqual(["/", before]);
    act(() => {
      history.back();
    });
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(probe()).toEqual(["/", before]);
  });

  it("removes trailing slashes but keeps the root", () => {
    expect(normalizePath("/admin/users/")).toBe("/admin/users");
    expect(normalizePath("/admin//")).toBe("/admin");
    expect(normalizePath("/")).toBe("/");
  });
});
