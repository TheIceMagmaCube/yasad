import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../test-utils";
import { LoadError } from "./LoadError";

afterEach(cleanup);

function Page({ failed, attempt, pending = false, onRetry = vi.fn() }: { failed: boolean; attempt: number; pending?: boolean; onRetry?: () => void }) {
  return (
    <main id="content" tabIndex={-1}>
      <h1 tabIndex={-1}>Users</h1>
      {failed ? <LoadError attempt={attempt} message="The list could not be loaded." pending={pending} onRetry={onRetry} /> : <p>List</p>}
    </main>
  );
}

describe("LoadError", () => {
  it("keeps the focus on Retry while it runs and on a new failure, with a new alert", async () => {
    const onRetry = vi.fn();
    const { rerender } = renderWithProviders(<Page failed attempt={1} onRetry={onRetry} />);
    const first = screen.getByRole("alert");
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
    rerender(<Page failed attempt={1} pending />);
    expect(screen.getByRole("button", { name: "Trying again…" })).toHaveFocus();
    rerender(<Page failed attempt={2} />);
    expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus();
    expect(screen.getByRole("alert")).not.toBe(first);
  });

  it("moves the focus to the page heading when a retry succeeds", async () => {
    const { rerender } = renderWithProviders(<Page failed attempt={1} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    rerender(<Page failed={false} attempt={1} />);
    expect(screen.getByRole("heading", { name: "Users" })).toHaveFocus();
  });

  it("leaves the focus alone when it goes away without a retry", () => {
    const { rerender } = renderWithProviders(<Page failed attempt={1} />);
    rerender(<Page failed={false} attempt={1} />);
    expect(document.body).toHaveFocus();
  });
});
