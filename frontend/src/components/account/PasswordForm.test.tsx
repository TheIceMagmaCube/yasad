import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mockApi, renderWithProviders } from "../../test-utils";
import { PasswordForm } from "./PasswordForm";

const BOB = { id: "bob", name: "Bob", email: "bob@example.invalid", role: "user" };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function fill(current: string, next: string, confirm = next, currentLabel = "Temporary password") {
  const user = userEvent.setup();
  if (current) await user.type(screen.getByLabelText(currentLabel), current);
  if (next) await user.type(screen.getByLabelText("New password"), next);
  if (confirm) await user.type(screen.getByLabelText("Confirm new password"), confirm);
  await user.click(screen.getByRole("button", { name: "Save password" }));
}

describe("PasswordForm, temporary password", () => {
  it("says why, and who is signed in", () => {
    renderWithProviders(<PasswordForm mode="temporary" user={BOB} onDone={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Choose your password" })).toBeInTheDocument();
    expect(screen.getByText(/the rest of YASAD opens once this is done/)).toBeInTheDocument();
    expect(screen.getByText("Signed in as Bob (bob@example.invalid).")).toBeInTheDocument();
    expect(screen.getByLabelText("Temporary password")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.queryByLabelText("Current password")).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("reports the three rules in one pass before calling the API", async () => {
    const fetchMock = mockApi({});
    renderWithProviders(<PasswordForm mode="temporary" user={BOB} onDone={vi.fn()} />);
    await fill("", "short", "other");
    expect(screen.getByLabelText("Temporary password")).toHaveAccessibleDescription("Error: Fill in this field.");
    expect(screen.getByLabelText("New password")).toHaveAccessibleDescription(/Use 12 to 128 characters./);
    expect(screen.getByLabelText("Confirm new password")).toHaveAccessibleDescription(/The passwords do not match./);
    const summary = screen.getByRole("group", { name: "Check the highlighted fields." });
    expect(summary).toHaveFocus();
    expect(within(summary).getAllByRole("link")).toHaveLength(3);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a wrong current password once in the summary and once under the field", async () => {
    mockApi({ "POST /api/account/password": { status: 403, body: { error: { code: "invalid_password", message: "" } } } });
    const onDone = vi.fn();
    renderWithProviders(<PasswordForm mode="temporary" user={BOB} onDone={onDone} />);
    await fill("wrong password!", "a brand new passphrase");
    const summary = await screen.findByRole("group", { name: "Check the highlighted fields." });
    expect(summary).toHaveFocus();
    expect(within(summary).getByRole("link", { name: "The current password is not correct." })).toBeInTheDocument();
    expect(screen.getAllByText("The current password is not correct.")).toHaveLength(2);
    expect(screen.getByLabelText("Temporary password")).toHaveAccessibleDescription("Error: The current password is not correct.");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("puts the server's field error on the new password", async () => {
    mockApi({
      "POST /api/account/password": {
        status: 422,
        body: { error: { code: "invalid_input", message: "", fields: { newPassword: "password_unchanged" } } },
      },
    });
    renderWithProviders(<PasswordForm mode="temporary" user={BOB} onDone={vi.fn()} />);
    await fill("a brand new passphrase!", "a brand new passphrase");
    expect(await screen.findByLabelText("New password")).toHaveAccessibleDescription(/different from the current one/);
  });

  it("calls onDone once saved", async () => {
    const fetchMock = mockApi({ "POST /api/account/password": { status: 204 } });
    const onDone = vi.fn();
    renderWithProviders(<PasswordForm mode="temporary" user={BOB} onDone={onDone} />);
    await fill("temporary password", "a brand new passphrase");
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({ currentPassword: "temporary password", newPassword: "a brand new passphrase" });
  });
});

describe("PasswordForm, account page", () => {
  it("focuses the current password, and closes on Cancel or Escape", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderWithProviders(<PasswordForm mode="account" onDone={vi.fn()} onCancel={onCancel} />);
    expect(screen.getByLabelText("Current password")).toHaveFocus();
    expect(screen.queryByRole("heading")).toBeNull();
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("says when the account has no password here", async () => {
    mockApi({ "POST /api/account/password": { status: 409, body: { error: { code: "no_local_password", message: "" } } } });
    renderWithProviders(<PasswordForm mode="account" onDone={vi.fn()} onCancel={vi.fn()} />);
    await fill("a password here", "a brand new passphrase", undefined, "Current password");
    expect(await screen.findByRole("group", { name: /signs in through the identity provider/ })).toHaveFocus();
  });
});
