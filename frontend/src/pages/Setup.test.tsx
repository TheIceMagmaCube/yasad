import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mockApi, renderWithProviders, sentBody } from "../test-utils";
import { Setup } from "./Setup";

const CODE = "setup-code-for-the-tests-0123456789";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function fillAdmin(user: ReturnType<typeof userEvent.setup>, password = "correct horse battery", confirm = password) {
  await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
  await user.type(screen.getByLabelText("E-mail"), "ada@example.org");
  await user.type(screen.getByLabelText("Password"), password);
  await user.type(screen.getByLabelText("Confirm password"), confirm);
}

describe("Setup", () => {
  it("goes from the code to the admin account to the final notice", async () => {
    const fetchMock = mockApi({
      "POST /api/setup/verify-code": { status: 204 },
      "POST /api/setup": { status: 201, body: { user: { name: "Ada Lovelace", email: "ada@example.org" } } },
    });
    const onDone = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<Setup onDone={onDone} onClosed={vi.fn()} />);

    await user.type(screen.getByLabelText("Setup code"), CODE);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Set up YASAD" })).toHaveFocus();

    await fillAdmin(user);
    await user.click(screen.getByRole("button", { name: "Create administrator" }));
    expect(sentBody(fetchMock, 1)).toEqual({
      code: CODE,
      name: "Ada Lovelace",
      email: "ada@example.org",
      password: "correct horse battery",
      passwordConfirm: "correct horse battery",
    });

    expect(screen.getByRole("heading", { name: "YASAD is ready" })).toHaveFocus();
    expect(screen.getByText(/remove SETUP_CODE/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Go to YASAD" }));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("shows the attempts left and focuses the error on a wrong code", async () => {
    mockApi({
      "POST /api/setup/verify-code": [
        { status: 403, body: { error: { code: "invalid_code", message: "", attemptsLeft: 4 } } },
        { status: 403, body: { error: { code: "invalid_code", message: "", attemptsLeft: 3 } } },
      ],
    });
    const user = userEvent.setup();
    renderWithProviders(<Setup onDone={vi.fn()} onClosed={vi.fn()} />);

    await user.type(screen.getByLabelText("Setup code"), "wrong");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert")).toHaveTextContent("4 attempts left");
    expect(screen.getByRole("alert")).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert")).toHaveTextContent("3 attempts left");
    expect(screen.getByRole("alert")).toHaveFocus();
  });

  it("reports too many attempts", async () => {
    mockApi({ "POST /api/setup/verify-code": { status: 429, body: { error: { code: "rate_limited", message: "" } } } });
    const user = userEvent.setup();
    renderWithProviders(<Setup onDone={vi.fn()} onClosed={vi.fn()} />);
    await user.type(screen.getByLabelText("Setup code"), "wrong");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Too many attempts");
  });

  it("checks the passwords before calling the API", async () => {
    const fetchMock = mockApi({ "POST /api/setup/verify-code": { status: 204 } });
    const user = userEvent.setup();
    renderWithProviders(<Setup onDone={vi.fn()} onClosed={vi.fn()} />);
    await user.type(screen.getByLabelText("Setup code"), CODE);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await fillAdmin(user, "short", "other");
    await user.click(screen.getByRole("button", { name: "Create administrator" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Confirm password")).toHaveAccessibleDescription("The passwords do not match.");
    expect(screen.getByRole("alert")).toHaveFocus();
  });

  it("lists each problem in the error summary, with a link to its field", async () => {
    mockApi({ "POST /api/setup/verify-code": { status: 204 } });
    const user = userEvent.setup();
    renderWithProviders(<Setup onDone={vi.fn()} onClosed={vi.fn()} />);
    await user.type(screen.getByLabelText("Setup code"), CODE);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await fillAdmin(user, "correct horse battery", "correct horse battery!");
    await user.click(screen.getByRole("button", { name: "Create administrator" }));
    const alert = screen.getByRole("alert");
    expect(alert).not.toHaveTextContent("Something went wrong");
    await user.click(within(alert).getByRole("link", { name: "The passwords do not match." }));
    expect(screen.getByLabelText("Confirm password")).toHaveFocus();
  });

  it("shows the server's field errors", async () => {
    mockApi({
      "POST /api/setup/verify-code": { status: 204 },
      "POST /api/setup": {
        status: 422,
        body: { error: { code: "invalid_input", message: "", fields: { email: "email_taken" } } },
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<Setup onDone={vi.fn()} onClosed={vi.fn()} />);
    await user.type(screen.getByLabelText("Setup code"), CODE);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await fillAdmin(user);
    await user.click(screen.getByRole("button", { name: "Create administrator" }));
    expect(screen.getByLabelText("E-mail")).toHaveAccessibleDescription("This e-mail address is already used by another account.");
  });

  it("hands over when setup is already closed", async () => {
    mockApi({ "POST /api/setup/verify-code": { status: 404, body: { error: { code: "setup_closed", message: "" } } } });
    const onClosed = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<Setup onDone={vi.fn()} onClosed={onClosed} />);
    await user.type(screen.getByLabelText("Setup code"), CODE);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(onClosed).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent("Setup is already done.");
  });
});
