import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mockApi, renderWithProviders } from "../test-utils";
import { ChangePassword } from "./ChangePassword";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function fill(current: string, next: string, confirm = next) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Current password"), current);
  await user.type(screen.getByLabelText("New password"), next);
  await user.type(screen.getByLabelText("Confirm new password"), confirm);
  await user.click(screen.getByRole("button", { name: "Save password" }));
}

describe("ChangePassword", () => {
  it("checks length and confirmation before calling the API", async () => {
    const fetchMock = mockApi({});
    renderWithProviders(<ChangePassword onChanged={vi.fn()} />);
    await fill("temporary password", "short");
    expect(screen.getByLabelText("New password")).toHaveAccessibleDescription(/Use at least 12 characters./);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("focuses a clear error on a wrong current password", async () => {
    mockApi({ "POST /api/account/password": { status: 403, body: { error: { code: "invalid_password", message: "" } } } });
    const onChanged = vi.fn();
    renderWithProviders(<ChangePassword onChanged={onChanged} />);
    await fill("wrong password!", "a brand new passphrase");
    expect(screen.getByRole("alert")).toHaveTextContent("The current password is not correct.");
    expect(screen.getByRole("alert")).toHaveFocus();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("shows the server's field error", async () => {
    mockApi({
      "POST /api/account/password": {
        status: 422,
        body: { error: { code: "invalid_input", message: "", fields: { newPassword: "password_unchanged" } } },
      },
    });
    renderWithProviders(<ChangePassword onChanged={vi.fn()} />);
    await fill("a brand new passphrase", "a brand new passphrase");
    expect(screen.getByLabelText("New password")).toHaveAccessibleDescription(/different from the current one/);
  });
});
