import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mockApi, renderWithProviders, sentBody } from "../test-utils";
import { Account } from "./Account";

const ADA = { id: "ada", name: "Ada Lovelace", email: "ada@example.invalid", role: "admin" };
const LOCAL = { "GET /api/account": { status: 200, body: { origin: "local" } } };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const passwordSection = () => screen.getByRole("region", { name: "Password" });

describe("Account", () => {
  it("shows the profile from the session before the server answers, without a jump in the password section", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    renderWithProviders(<Account user={ADA} onProfileChanged={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1, name: "My account" })).toBeInTheDocument();
    const profile = screen.getByRole("region", { name: "Profile" });
    expect(profile).toHaveTextContent("Ada Lovelace");
    expect(profile).toHaveTextContent("ada@example.invalid");
    expect(profile).toHaveTextContent("Administrator");
    expect(profile).toHaveTextContent("Loading…");
    expect(within(passwordSection()).getByRole("heading", { level: 2, name: "Password" })).toBeInTheDocument();
    expect(passwordSection()).toHaveAttribute("aria-busy", "true");
    expect(passwordSection().querySelector('[data-slot="password-placeholder"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Change password" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit profile" })).toBeNull();
  });

  it("offers the password and the profile form to a local account", async () => {
    mockApi(LOCAL);
    renderWithProviders(<Account user={ADA} onProfileChanged={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Change password" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Changing it signs you out of your other devices.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Profile" })).toHaveTextContent("Password");
    expect(screen.getByRole("button", { name: "Edit profile" })).toBeInTheDocument();
  });

  it("leaves the profile and the password of an identity provider account to the provider", async () => {
    mockApi({ "GET /api/account": { status: 200, body: { origin: "oidc" } } });
    renderWithProviders(<Account user={{ ...ADA, role: "user" }} onProfileChanged={vi.fn()} />);
    expect(await screen.findByText("Your name and e-mail come from your identity provider. Change them there.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Profile" })).toHaveTextContent("Identity provider");
    expect(screen.queryByRole("region", { name: "Password" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit profile" })).toBeNull();
  });

  it("says when the sign-in method cannot be loaded, never as 'no password', and tries again", async () => {
    const user = userEvent.setup();
    mockApi({ "GET /api/account": [{ status: 500, body: { error: { code: "internal_error", message: "" } } }, LOCAL["GET /api/account"]] });
    // In a main region, as in the app: the page heading is found there.
    renderWithProviders(
      <main id="content">
        <Account user={ADA} onProfileChanged={vi.fn()} />
      </main>,
    );
    expect(await within(passwordSection()).findByText("Your sign-in method could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change password" })).toBeNull();
    await user.click(within(passwordSection()).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Change password" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "My account" })).toHaveFocus();
  });

  it("opens the password form on its first field, and gives the focus back on Escape", async () => {
    const user = userEvent.setup();
    mockApi(LOCAL);
    renderWithProviders(<Account user={ADA} onProfileChanged={vi.fn()} />);
    const toggle = await screen.findByRole("button", { name: "Change password" });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", "account-password-form");
    expect(screen.getByLabelText("Current password")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("Current password")).toBeNull();
    await waitFor(() => expect(toggle).toHaveFocus());
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("says the password changed in a status line, with the focus back on the button", async () => {
    const user = userEvent.setup();
    mockApi({ ...LOCAL, "POST /api/account/password": { status: 204 } });
    renderWithProviders(<Account user={ADA} onProfileChanged={vi.fn()} />);
    const toggle = await screen.findByRole("button", { name: "Change password" });
    const status = within(passwordSection()).getByRole("status");
    expect(status).toBeEmptyDOMElement();
    await user.click(toggle);
    await user.type(screen.getByLabelText("Current password"), "correct horse battery");
    await user.type(screen.getByLabelText("New password"), "a brand new passphrase");
    await user.type(screen.getByLabelText("Confirm new password"), "a brand new passphrase");
    await user.click(screen.getByRole("button", { name: "Save password" }));
    await waitFor(() => expect(toggle).toHaveFocus());
    expect(status).toHaveTextContent("Password changed. Your other sessions were closed.");
    expect(screen.queryByLabelText("Current password")).toBeNull();
    await user.click(toggle);
    expect(status).toBeEmptyDOMElement();
  });

  it("wraps a very long name instead of widening the page", async () => {
    mockApi(LOCAL);
    const name = "Ada".repeat(60);
    renderWithProviders(<Account user={{ ...ADA, name }} onProfileChanged={vi.fn()} />);
    expect(screen.getByText(name)).toHaveClass("wrap-anywhere");
    await screen.findByRole("button", { name: "Change password" });
  });
});

describe("Account, profile form", () => {
  async function openProfile() {
    const user = userEvent.setup();
    const toggle = await screen.findByRole("button", { name: "Edit profile" });
    await user.click(toggle);
    return { user, toggle };
  }

  it("changes the name without asking for the password", async () => {
    const fetchMock = mockApi({ ...LOCAL, "PATCH /api/account": { status: 200, body: { user: { ...ADA, name: "Ada King" } } } });
    const onProfileChanged = vi.fn(async () => {});
    renderWithProviders(<Account user={ADA} onProfileChanged={onProfileChanged} />);
    const { user, toggle } = await openProfile();
    const name = screen.getByLabelText("Name");
    expect(name).toHaveFocus();
    expect(screen.queryByLabelText("Current password")).toBeNull();
    await user.clear(name);
    await user.type(name, "Ada King");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(toggle).toHaveFocus());
    expect(onProfileChanged).toHaveBeenCalledOnce();
    expect(sentBody(fetchMock, 1)).toEqual({ name: "Ada King" });
    expect(within(screen.getByRole("region", { name: "Profile" })).getByRole("status")).toHaveTextContent("Profile saved.");
  });

  it("asks for the current password when the e-mail changes, and sends it", async () => {
    const fetchMock = mockApi({ ...LOCAL, "PATCH /api/account": { status: 200, body: { user: ADA } } });
    renderWithProviders(<Account user={ADA} onProfileChanged={vi.fn(async () => {})} />);
    const { user } = await openProfile();
    const email = screen.getByLabelText("E-mail");
    await user.clear(email);
    await user.type(email, "ada@lovelace.invalid");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    const field = screen.getByLabelText("Current password");
    expect(field).toHaveAccessibleDescription("Needed to change your e-mail. Error: Fill in this field.");
    expect(screen.getByRole("group", { name: "Check the highlighted fields." })).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.type(field, "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sentBody(fetchMock, 1)).toEqual({ email: "ada@lovelace.invalid", currentPassword: "correct horse battery" });
  });

  it("puts a taken address on the e-mail field and a wrong password on its field", async () => {
    mockApi({
      ...LOCAL,
      "PATCH /api/account": [
        { status: 422, body: { error: { code: "invalid_input", message: "", fields: { email: "email_taken" } } } },
        { status: 403, body: { error: { code: "invalid_password", message: "" } } },
      ],
    });
    renderWithProviders(<Account user={ADA} onProfileChanged={vi.fn()} />);
    const { user } = await openProfile();
    const email = screen.getByLabelText("E-mail");
    await user.clear(email);
    await user.type(email, "grace@example.invalid");
    await user.type(screen.getByLabelText("Current password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    const summary = await screen.findByRole("group", { name: "Check the highlighted fields." });
    expect(summary).toHaveFocus();
    await user.click(within(summary).getByRole("link", { name: "This e-mail address is already used by another account." }));
    expect(email).toHaveFocus();
    expect(email).toHaveAttribute("aria-invalid", "true");

    await user.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(screen.getByLabelText("Current password")).toHaveAccessibleDescription(/The current password is not correct./));
  });

  it("closes like Cancel when nothing changed, and on Escape", async () => {
    const fetchMock = mockApi(LOCAL);
    renderWithProviders(<Account user={ADA} onProfileChanged={vi.fn()} />);
    const { user, toggle } = await openProfile();
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(toggle).toHaveFocus());
    expect(screen.queryByLabelText("Name")).toBeNull();
    await user.click(toggle);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(toggle).toHaveFocus());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("says so when the server owns the profile after all", async () => {
    mockApi({ ...LOCAL, "PATCH /api/account": { status: 409, body: { error: { code: "profile_from_provider", message: "" } } } });
    renderWithProviders(<Account user={ADA} onProfileChanged={vi.fn()} />);
    const { user } = await openProfile();
    await user.type(screen.getByLabelText("Name"), " King");
    await act(() => user.click(screen.getByRole("button", { name: "Save profile" })));
    expect(await screen.findByRole("group", { name: /come from your identity provider/ })).toHaveFocus();
  });
});
