import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getStatus, mockApi, renderWithProviders, sentBody } from "../test-utils";
import { InstanceContext } from "../instance";
import { Setup } from "./Setup";

const CODE = "setup-code-for-the-tests-0123456789";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function fillAdmin(user: ReturnType<typeof userEvent.setup>, password = "correct horse battery", confirm = password) {
  await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
  await user.type(screen.getByLabelText("E-mail"), "ada@example.invalid");
  await user.type(screen.getByLabelText("Password"), password);
  await user.type(screen.getByLabelText("Confirm password"), confirm);
}

async function passCode(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Setup code"), CODE);
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

/** Return the focused error summary, named by its title. */
const summary = (name = "Check the highlighted fields.") => screen.getByRole("group", { name });

describe("Setup", () => {
  it("leaves the focus alone on its first render, under StrictMode too", () => {
    renderWithProviders(
      <StrictMode>
        <Setup onDone={vi.fn()} onClosed={vi.fn()} />
      </StrictMode>,
    );
    expect(screen.getByRole("heading", { name: "Set up YASAD" })).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });

  it("goes from the code to the admin account to the final notice", async () => {
    const fetchMock = mockApi({
      "POST /api/setup/verify-code": { status: 204 },
      "POST /api/setup": { status: 201, body: { user: { name: "Ada Lovelace", email: "ada@example.invalid" } } },
    });
    const onDone = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<Setup onDone={onDone} onClosed={vi.fn()} />);

    await passCode(user);
    expect(screen.getByRole("heading", { name: "Set up YASAD" })).toHaveFocus();
    const steps = screen.getByRole("list", { name: "Setup progress" });
    expect(within(steps).getAllByRole("listitem")[0]).toHaveTextContent("Step 1 of 2: Setup code, done");
    expect(within(steps).getAllByRole("listitem")[1]).toHaveAttribute("aria-current", "step");
    expect(steps).not.toHaveTextContent("✓");
    // The yellow marker alone is too light against the page: the inset ring is its boundary.
    expect(within(steps).getAllByRole("listitem")[1]!.querySelector("[aria-hidden]")).toHaveClass("shadow-[inset_0_0_0_2px_var(--control-primary-ring)]");

    await fillAdmin(user);
    await user.click(screen.getByRole("button", { name: "Create administrator" }));
    expect(sentBody(fetchMock, 1)).toEqual({
      code: CODE,
      name: "Ada Lovelace",
      email: "ada@example.invalid",
      password: "correct horse battery",
      passwordConfirm: "correct horse battery",
    });

    expect(screen.getByRole("heading", { name: "YASAD is ready" })).toHaveFocus();
    await waitFor(() => expect(document.title).toBe("YASAD is ready - YASAD"));
    expect(getStatus()).toHaveTextContent("Signed in as Ada Lovelace.");
    expect(screen.getByRole("note")).toHaveTextContent("One more stepRemove SETUP_CODE");
    await user.click(screen.getByRole("button", { name: "Go to YASAD" }));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("asks for the code as plain text, without autocorrection", () => {
    renderWithProviders(<Setup onDone={vi.fn()} onClosed={vi.fn()} />);
    const code = screen.getByLabelText("Setup code");
    expect(code).toHaveAttribute("type", "text");
    expect(code).toHaveAttribute("spellcheck", "false");
    expect(code).toHaveAttribute("autocapitalize", "none");
    expect(code).toHaveAttribute("autocomplete", "off");
    expect(code).toHaveClass("font-mono");
    expect(code).toHaveAccessibleDescription("Enter the code set in SETUP_CODE on the server.");
  });

  it("puts a wrong code on its field, keeps it, and selects it from the summary link", async () => {
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
    expect(summary()).toHaveFocus();
    const code = screen.getByLabelText("Setup code");
    expect(code).toHaveAccessibleDescription(/Error: This code is not valid. 4 attempts left./);
    expect(code).toHaveValue("wrong");
    await user.click(within(summary()).getByRole("link", { name: "This code is not valid. 4 attempts left." }));
    expect(code).toHaveFocus();
    expect([code as HTMLInputElement].map((el) => el.value.slice(el.selectionStart!, el.selectionEnd!))).toEqual(["wrong"]);

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(summary()).toHaveFocus();
    expect(summary()).toHaveTextContent("3 attempts left");
  });

  it("refocuses the summary when the same error comes back", async () => {
    mockApi({ "POST /api/setup/verify-code": { status: 403, body: { error: { code: "invalid_code", message: "" } } } });
    const user = userEvent.setup();
    renderWithProviders(<Setup onDone={vi.fn()} onClosed={vi.fn()} />);
    await user.type(screen.getByLabelText("Setup code"), "wrong");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    const first = summary();
    await user.click(screen.getByLabelText("Setup code"));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(summary()).toHaveFocus();
    expect(summary()).not.toBe(first);
  });

  it("reports too many attempts without marking the field", async () => {
    mockApi({ "POST /api/setup/verify-code": { status: 429, body: { error: { code: "rate_limited", message: "" } } } });
    const user = userEvent.setup();
    renderWithProviders(<Setup onDone={vi.fn()} onClosed={vi.fn()} />);
    await user.type(screen.getByLabelText("Setup code"), "wrong");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(summary("Too many attempts. Try again later.")).toHaveFocus();
    expect(screen.getByLabelText("Setup code")).not.toHaveAttribute("aria-invalid");
  });

  it("asks for the code before calling the API", async () => {
    const fetchMock = mockApi({});
    const user = userEvent.setup();
    renderWithProviders(<Setup onDone={vi.fn()} onClosed={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Setup code")).toHaveAccessibleDescription(/Fill in this field./);
  });

  it("checks every admin field in one pass before calling the API", async () => {
    const fetchMock = mockApi({ "POST /api/setup/verify-code": { status: 204 } });
    const user = userEvent.setup();
    renderWithProviders(<Setup onDone={vi.fn()} onClosed={vi.fn()} />);
    await passCode(user);

    await user.type(screen.getByLabelText("Password"), "short");
    await user.type(screen.getByLabelText("Confirm password"), "other");
    await user.click(screen.getByRole("button", { name: "Create administrator" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(summary()).toHaveFocus();
    expect(within(summary()).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Name: Fill in this field.",
      "E-mail: Fill in this field.",
      "Password: Use 12 to 128 characters.",
      "Confirm password: The passwords do not match.",
    ]);
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Confirm password")).toHaveAccessibleDescription("Error: The passwords do not match.");
  });

  it("links each problem of the summary to its field", async () => {
    mockApi({ "POST /api/setup/verify-code": { status: 204 } });
    const user = userEvent.setup();
    renderWithProviders(<Setup onDone={vi.fn()} onClosed={vi.fn()} />);
    await passCode(user);

    await fillAdmin(user, "correct horse battery", "correct horse battery!");
    await user.click(screen.getByRole("button", { name: "Create administrator" }));
    expect(summary()).not.toHaveTextContent("Something went wrong");
    await user.click(within(summary()).getByRole("link", { name: "Confirm password: The passwords do not match." }));
    expect(screen.getByLabelText("Confirm password")).toHaveFocus();
  });

  it("shows the server's field errors, and lists an unknown field without a link", async () => {
    mockApi({
      "POST /api/setup/verify-code": { status: 204 },
      "POST /api/setup": {
        status: 422,
        body: { error: { code: "invalid_input", message: "", fields: { email: "email_taken", other: "invalid_value" } } },
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<Setup onDone={vi.fn()} onClosed={vi.fn()} />);
    await passCode(user);
    await fillAdmin(user);
    await user.click(screen.getByRole("button", { name: "Create administrator" }));
    expect(screen.getByLabelText("E-mail")).toHaveAccessibleDescription("Error: This e-mail address is already used by another account.");
    expect(within(summary()).getByText("This value is not valid.").closest("a")).toBeNull();
  });

  it("goes back to the code step with the summary when the code stopped working", async () => {
    mockApi({
      "POST /api/setup/verify-code": { status: 204 },
      "POST /api/setup": { status: 403, body: { error: { code: "invalid_code", message: "", attemptsLeft: 2 } } },
    });
    const user = userEvent.setup();
    renderWithProviders(<Setup onDone={vi.fn()} onClosed={vi.fn()} />);
    await passCode(user);
    await fillAdmin(user);
    await user.click(screen.getByRole("button", { name: "Create administrator" }));
    expect(summary()).toHaveFocus();
    expect(screen.getByLabelText("Setup code")).toHaveAccessibleDescription(/This code is not valid. 2 attempts left./);
  });

  it("shows the setup closed screen, focused, with a way to sign in", async () => {
    mockApi({ "POST /api/setup/verify-code": { status: 404, body: { error: { code: "setup_closed", message: "" } } } });
    const onClosed = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<Setup onDone={vi.fn()} onClosed={onClosed} />);
    await passCode(user);
    expect(screen.getByRole("heading", { level: 1, name: "Setup is already done" })).toHaveFocus();
    await waitFor(() => expect(document.title).toBe("Setup is already done - YASAD"));
    expect(screen.getByText(/An administrator account exists/)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Setup progress" })).toBeNull();
    expect(onClosed).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Go to sign-in" }));
    expect(onClosed).toHaveBeenCalledOnce();
  });

  it("offers the provider on the first step when OIDC is configured, without starting it", () => {
    const fetchMock = mockApi({});
    renderWithProviders(
      <InstanceContext value={{ title: "YASAD", logo: null, theme: "default", defaultLanguage: "en", passwordSignIn: true, oidc: { name: "Okta" } }}>
        <Setup onDone={vi.fn()} onClosed={vi.fn()} providerError={{ code: "not_allowed" }} />
      </InstanceContext>,
    );
    expect(screen.getByLabelText("Setup code")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with Okta" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Your account does not have access to this portal." })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers no provider without OIDC", () => {
    renderWithProviders(<Setup onDone={vi.fn()} onClosed={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Sign in with/ })).toBeNull();
  });
});
