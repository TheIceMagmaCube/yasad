import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mockApi, renderWithProviders, sentBody } from "../test-utils";
import { SignIn } from "./SignIn";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function signIn(password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("E-mail"), "ada@example.org");
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("SignIn", () => {
  it("signs in with e-mail and password", async () => {
    const fetchMock = mockApi({ "POST /api/auth/sign-in/email": { status: 200, body: {} } });
    const onSignedIn = vi.fn();
    renderWithProviders(<SignIn onSignedIn={onSignedIn} />);
    await signIn("correct horse battery");
    expect(sentBody(fetchMock, 0)).toEqual({ email: "ada@example.org", password: "correct horse battery" });
    expect(onSignedIn).toHaveBeenCalledOnce();
  });

  it("focuses a clear error on wrong credentials", async () => {
    mockApi({ "POST /api/auth/sign-in/email": { status: 401, body: { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid" } } });
    const onSignedIn = vi.fn();
    renderWithProviders(<SignIn onSignedIn={onSignedIn} />);
    await signIn("wrong password!");
    expect(screen.getByRole("alert")).toHaveTextContent("Wrong e-mail or password.");
    expect(screen.getByRole("alert")).toHaveFocus();
    expect(onSignedIn).not.toHaveBeenCalled();
  });
});
