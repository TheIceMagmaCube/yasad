import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InstanceContext } from "../instance";
import { leavePage } from "../lib/sign-in";
import { getAnnouncer, mockApi, renderWithProviders, sentBody } from "../test-utils";
import { SignIn } from "./SignIn";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const INSTANCE = { title: "YASAD", logo: null, theme: "default", defaultLanguage: "en", passwordSignIn: true, oidc: null } as const;

async function signIn(password: string, email = "ada@example.invalid") {
  const user = userEvent.setup();
  if (email) await user.type(screen.getByLabelText("E-mail"), email);
  if (password) await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  return user;
}

/** Return the error summary, a focused group named by its title. */
const summary = (name: string) => screen.getByRole("group", { name });

describe("SignIn", () => {
  it("greets with a line drawn from the greetings, under the title, and keeps the main submit", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    renderWithProviders(<SignIn onSignedIn={vi.fn()} />);
    const heading = screen.getByRole("heading", { level: 1, name: "Sign in" });
    const greeting = screen.getByText("Your links missed you. Mostly the bookmarks.");
    expect(heading.compareDocumentPosition(greeting) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveClass("bg-primary");
  });

  it("shows the greeting in the language just chosen on the same screen", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    renderWithProviders(<SignIn onSignedIn={vi.fn()} />);
    await userEvent.setup().selectOptions(screen.getByLabelText("Language / Langue"), "fr");
    expect(screen.getByText("Vos liens vous ont manqué. Surtout les favoris.")).toBeInTheDocument();
    expect(screen.queryByText("Your links missed you. Mostly the bookmarks.")).toBeNull();
  });

  it("signs in with e-mail and password", async () => {
    const fetchMock = mockApi({ "POST /api/auth/sign-in/email": { status: 200, body: {} } });
    const onSignedIn = vi.fn();
    renderWithProviders(<SignIn onSignedIn={onSignedIn} />);
    await signIn("correct horse battery");
    expect(sentBody(fetchMock, 0)).toEqual({ email: "ada@example.invalid", password: "correct horse battery" });
    expect(onSignedIn).toHaveBeenCalledOnce();
  });

  it("checks both fields at once and sends nothing when they are empty", async () => {
    const fetchMock = mockApi({});
    renderWithProviders(<SignIn onSignedIn={vi.fn()} />);
    await signIn("", "");
    expect(fetchMock).not.toHaveBeenCalled();
    const box = summary("Check the highlighted fields.");
    expect(box).toHaveFocus();
    expect(within(box).getAllByRole("link")).toHaveLength(2);
    expect(screen.getByLabelText("E-mail")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("Error: Fill in this field.");
  });

  it("marks both fields on wrong credentials, empties the password and links to it", async () => {
    mockApi({ "POST /api/auth/sign-in/email": { status: 401, body: { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid" } } });
    const onSignedIn = vi.fn();
    renderWithProviders(<SignIn onSignedIn={onSignedIn} />);
    const user = await signIn("wrong password!");
    const box = summary("Wrong e-mail or password.");
    expect(box).toHaveFocus();
    const email = screen.getByLabelText("E-mail");
    const password = screen.getByLabelText("Password");
    for (const field of [email, password]) {
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(field).toHaveAccessibleDescription("Wrong e-mail or password.");
    }
    expect(password).toHaveValue("");
    expect(password).toHaveAttribute("type", "password");
    expect(email).toHaveValue("ada@example.invalid");
    await user.click(within(box).getByRole("link", { name: "Enter your password again" }));
    expect(password).toHaveFocus();
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it("puts an invalid e-mail on the e-mail field only, keeping the password", async () => {
    mockApi({ "POST /api/auth/sign-in/email": { status: 400, body: { code: "INVALID_EMAIL", message: "Invalid email" } } });
    renderWithProviders(<SignIn onSignedIn={vi.fn()} />);
    await signIn("correct horse battery", "ada");
    expect(summary("Check the highlighted fields.")).toHaveFocus();
    expect(screen.getByLabelText("E-mail")).toHaveAccessibleDescription("Error: Enter a valid e-mail address.");
    expect(screen.getByLabelText("Password")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText("Password")).toHaveValue("correct horse battery");
  });

  it("says when the account is disabled, with the title alone", async () => {
    mockApi({ "POST /api/auth/sign-in/email": { status: 403, body: { error: { code: "account_disabled", message: "Disabled" } } } });
    renderWithProviders(<SignIn onSignedIn={vi.fn()} />);
    await signIn("correct horse battery");
    const box = summary("This account is disabled. Ask your administrator.");
    expect(box).toHaveFocus();
    expect(within(box).queryByRole("list")).toBeNull();
    expect(screen.getByLabelText("Password")).toHaveValue("correct horse battery");
  });

  it("shows its progress label and keeps the focus on the button while signing in, then announces it", async () => {
    let answer!: (res: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))),
    );
    renderWithProviders(<SignIn onSignedIn={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("E-mail"), "ada@example.invalid");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    const button = screen.getByRole("button", { name: "Sign in" });
    await user.click(button);
    expect(button).toHaveAccessibleName("Signing in…");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveFocus();
    expect(getAnnouncer()).toHaveTextContent("");
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Signing in…"));
    await user.click(button);
    expect(fetch).toHaveBeenCalledOnce();
    await act(async () => answer(new Response("{}", { status: 200 })));
    expect(button).toHaveAccessibleName("Sign in");
  });

  it("says that the session ended, focused, until the person submits", async () => {
    mockApi({ "POST /api/auth/sign-in/email": { status: 401, body: { code: "INVALID_EMAIL_OR_PASSWORD", message: "" } } });
    renderWithProviders(<SignIn onSignedIn={vi.fn()} expired />);
    const notice = screen.getByRole("group", { name: "Your session has ended. Sign in again to continue." });
    expect(notice).toHaveFocus();
    await signIn("wrong password!");
    expect(screen.queryByText("Your session has ended. Sign in again to continue.")).toBeNull();
  });

  it("toggles the password with a Show button that keeps its name and the focus", async () => {
    renderWithProviders(<SignIn onSignedIn={vi.fn()} />);
    const user = userEvent.setup();
    const password = screen.getByLabelText("Password");
    await user.type(password, "secret");
    const show = screen.getByRole("button", { name: "Show password" });
    expect(show).toHaveAttribute("aria-pressed", "false");
    await user.click(show);
    expect(password).toHaveAttribute("type", "text");
    expect(show).toHaveAttribute("aria-pressed", "true");
    expect(show).toHaveAccessibleName("Show password");
    expect(show).toHaveFocus();
  });

  describe("with password sign-in off", () => {
    const off = { ...INSTANCE, passwordSignIn: false };

    it("says so, links to the administrator sign-in, and back to the public links when there are some", () => {
      renderWithProviders(
        <InstanceContext value={off}>
          <SignIn onSignedIn={vi.fn()} publicHome />
        </InstanceContext>,
      );
      expect(screen.getByRole("heading", { level: 1, name: "Password sign-in is off" })).toBeInTheDocument();
      expect(screen.getByText("Ask your administrator how to sign in.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Administrator? Sign in with a password" })).toHaveAttribute("href", "/sign-in/local");
      expect(screen.getByRole("link", { name: "Back to the links" })).toHaveAttribute("href", "/");
      expect(screen.queryByLabelText("Password")).toBeNull();
    });

    it("has no way back to links that do not exist", () => {
      renderWithProviders(
        <InstanceContext value={off}>
          <SignIn onSignedIn={vi.fn()} />
        </InstanceContext>,
      );
      expect(screen.queryByRole("link", { name: "Back to the links" })).toBeNull();
    });

    it("titles the form on /sign-in/local as the administrator sign-in", async () => {
      renderWithProviders(
        <InstanceContext value={off}>
          <SignIn onSignedIn={vi.fn()} local />
        </InstanceContext>,
      );
      expect(screen.getByRole("heading", { level: 1, name: "Administrator sign-in" })).toBeInTheDocument();
      expect(screen.getByText("Reserved to administrators.")).toBeInTheDocument();
      await waitFor(() => expect(document.title).toBe("Administrator sign-in - YASAD"));
    });
  });

  describe("with an identity provider", () => {
    const AUTHORIZE = "https://idp.example.invalid/authorize";
    const withOidc = (passwordSignIn: boolean) => ({ ...INSTANCE, passwordSignIn, oidc: { name: "Okta" } });

    afterEach(() => {
      vi.restoreAllMocks();
      history.replaceState(null, "", "/");
    });

    it("puts the provider button first, then the password form after \"or\"", () => {
      renderWithProviders(
        <InstanceContext value={withOidc(true)}>
          <SignIn onSignedIn={vi.fn()} />
        </InstanceContext>,
      );
      const button = screen.getByRole("button", { name: "Sign in with Okta" });
      const or = screen.getByText("or");
      const email = screen.getByLabelText("E-mail");
      expect(button.compareDocumentPosition(or) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(or.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // The provider is the one main action: the password submit steps down to the outline style.
      expect(screen.getByRole("button", { name: "Sign in" })).toHaveClass("border-input");
      expect(screen.getByRole("button", { name: "Sign in" })).not.toHaveClass("bg-primary");
    });

    it("offers only the provider and the administrator link when password sign-in is off", () => {
      renderWithProviders(
        <InstanceContext value={withOidc(false)}>
          <SignIn onSignedIn={vi.fn()} />
        </InstanceContext>,
      );
      expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Sign in with Okta" })).toBeInTheDocument();
      expect(screen.queryByText("Ask your administrator how to sign in.")).toBeNull();
      expect(screen.queryByLabelText("Password")).toBeNull();
      expect(screen.getByRole("link", { name: "Administrator? Sign in with a password" })).toHaveAttribute("href", "/sign-in/local");
    });

    it("keeps the fallback link on screen while it redirects, and comes back to the page it is on", async () => {
      const replace = vi.spyOn(leavePage, "replace").mockImplementation(() => {});
      const fetchMock = mockApi({ "POST /api/auth/sign-in/social": { status: 200, body: { url: AUTHORIZE } } });
      history.replaceState(null, "", "/admin/groups");
      renderWithProviders(
        <InstanceContext value={withOidc(false)}>
          <SignIn onSignedIn={vi.fn()} autoRedirect />
        </InstanceContext>,
      );
      expect(screen.getByText("Redirecting to Okta…")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Administrator? Sign in with a password" })).toBeInTheDocument();
      await waitFor(() => expect(replace).toHaveBeenCalledWith(AUTHORIZE));
      expect(sentBody(fetchMock, 0)).toEqual({ returnTo: "/admin/groups" });
    });

    it("comes back to the home page from a sign-in path", async () => {
      const assign = vi.spyOn(leavePage, "assign").mockImplementation(() => {});
      const fetchMock = mockApi({ "POST /api/auth/sign-in/social": { status: 200, body: { url: AUTHORIZE } } });
      history.replaceState(null, "", "/sign-in");
      renderWithProviders(
        <InstanceContext value={withOidc(true)}>
          <SignIn onSignedIn={vi.fn()} />
        </InstanceContext>,
      );
      await userEvent.setup().click(screen.getByRole("button", { name: "Sign in with Okta" }));
      await waitFor(() => expect(assign).toHaveBeenCalledWith(AUTHORIZE));
      expect(sentBody(fetchMock, 0)).toEqual({});
    });

    it("shows the error from the address, focused", () => {
      renderWithProviders(
        <InstanceContext value={withOidc(false)}>
          <SignIn onSignedIn={vi.fn()} error={{ code: "account_disabled" }} />
        </InstanceContext>,
      );
      expect(screen.getByRole("group", { name: "This account is disabled. Ask your administrator." })).toHaveFocus();
    });
  });
});
