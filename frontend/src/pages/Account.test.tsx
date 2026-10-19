import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getAnnouncer, mockApi, renderWithProviders, sentBody } from "../test-utils";
import { Account } from "./Account";

const ADA = { id: "ada", name: "Ada Lovelace", email: "ada@example.invalid", role: "admin" };
const LOCAL = { "GET /api/account": { status: 200, body: { origin: "local" } } };
const OIDC = { "GET /api/account": { status: 200, body: { origin: "oidc" } } };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.lang = "en";
  document.documentElement.removeAttribute("data-mode");
});

/** Return the setting row named `label`. */
const row = (label: string) => screen.getByRole("listitem", { name: label });

describe("Account", () => {
  it("shows who is signed in from the session before the server answers, the password row waiting", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    renderWithProviders(<Account user={ADA} onProfileChanged={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Ada Lovelace" })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toHaveTextContent("ada@example.invalid");
    expect(screen.getByRole("banner")).toHaveTextContent("Administrator");
    expect(screen.getByRole("banner")).not.toHaveTextContent("Signs in with");
    expect(row("Name")).toHaveTextContent("Ada Lovelace");
    expect(row("E-mail")).toHaveTextContent("ada@example.invalid");
    expect(row("Password")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("button", { name: "Change password" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit: Name" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit: E-mail" })).toBeNull();
  });

  it("offers each field and the password of a local account in its row", async () => {
    mockApi(LOCAL);
    renderWithProviders(<Account user={ADA} onProfileChanged={vi.fn()} />);
    expect(await within(row("Password")).findByRole("button", { name: "Change password" })).toHaveAttribute("aria-expanded", "false");
    expect(row("Password")).toHaveTextContent("Set");
    expect(row("Password")).not.toHaveAttribute("aria-busy");
    expect(within(row("Name")).getByRole("button", { name: "Edit: Name" })).toHaveTextContent("Edit");
    expect(within(row("E-mail")).getByRole("button", { name: "Edit: E-mail" })).toHaveTextContent("Edit");
    expect(screen.getByRole("banner")).toHaveTextContent("Signs in with: password");
    expect(screen.queryByText("Managed by the identity provider")).toBeNull();
  });

  it("leaves the name, the e-mail and the password of an identity provider account to the provider", async () => {
    mockApi(OIDC);
    renderWithProviders(<Account user={{ ...ADA, role: "user" }} onProfileChanged={vi.fn()} />);
    expect(await within(row("E-mail")).findByText("Managed by the identity provider")).toBeInTheDocument();
    expect(within(row("Name")).getByText("Managed by the identity provider")).toBeInTheDocument();
    expect(row("E-mail")).toHaveTextContent("ada@example.invalid");
    expect(screen.queryByRole("listitem", { name: "Password" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
    expect(screen.getByRole("banner")).toHaveTextContent("User · Signs in with: identity provider");
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
    expect(await within(row("Password")).findByText("Your sign-in method could not be loaded.")).toBeInTheDocument();
    expect(row("Password")).not.toHaveTextContent("Set");
    expect(screen.queryByRole("button", { name: "Change password" })).toBeNull();
    await user.click(within(row("Password")).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Change password" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Ada Lovelace" })).toHaveFocus();
  });

  it("opens the password form in its row on its first field, and gives the focus back on Escape", async () => {
    const user = userEvent.setup();
    mockApi(LOCAL);
    renderWithProviders(<Account user={ADA} onProfileChanged={vi.fn()} />);
    const toggle = await screen.findByRole("button", { name: "Change password" });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", "account-password-form");
    expect(within(row("Password")).getByLabelText("Current password")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("Current password")).toBeNull();
    await waitFor(() => expect(toggle).toHaveFocus());
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("announces the new password, shows it in a status line and gives the focus back to the row's button", async () => {
    const user = userEvent.setup();
    mockApi({ ...LOCAL, "POST /api/account/password": { status: 204 } });
    renderWithProviders(<Account user={ADA} onProfileChanged={vi.fn()} />);
    const toggle = await screen.findByRole("button", { name: "Change password" });
    await user.click(toggle);
    await user.type(screen.getByLabelText("Current password"), "correct horse battery");
    await user.type(screen.getByLabelText("New password"), "a brand new passphrase");
    await user.type(screen.getByLabelText("Confirm new password"), "a brand new passphrase");
    await user.click(screen.getByRole("button", { name: "Save password" }));
    await waitFor(() => expect(toggle).toHaveFocus());
    const changed = "Password changed. Your other sessions were closed.";
    expect(getAnnouncer()).toHaveTextContent(changed);
    expect(document.querySelector('[data-slot="account-status"]')).toHaveTextContent(changed);
    expect(screen.queryByLabelText("Current password")).toBeNull();
    await user.click(toggle);
    expect(document.querySelector('[data-slot="account-status"]')).toBeNull();
  });

  it("switches the language with two toggle buttons, each in its own language, applied at once", async () => {
    const user = userEvent.setup();
    mockApi(LOCAL);
    renderWithProviders(<Account user={ADA} onProfileChanged={vi.fn()} />);
    await screen.findByRole("button", { name: "Change password" });
    const group = within(row("Language")).getByRole("group", { name: "Language" });
    const english = within(group).getByRole("button", { name: "English" });
    const french = within(group).getByRole("button", { name: "Français" });
    expect(english).toHaveAttribute("aria-pressed", "true");
    expect(french).toHaveAttribute("aria-pressed", "false");
    expect(french).toHaveAttribute("lang", "fr");
    await user.click(french);
    expect(french).toHaveAttribute("aria-pressed", "true");
    expect(english).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement.lang).toBe("fr");
    expect(localStorage.getItem("yasad.language")).toBe("fr");
    expect(screen.getByRole("button", { name: "Changer le mot de passe" })).toBeInTheDocument();
  });

  it("chooses the appearance with radio cards, applied at once", async () => {
    const user = userEvent.setup();
    mockApi(LOCAL);
    renderWithProviders(<Account user={ADA} onProfileChanged={vi.fn()} />);
    await screen.findByRole("button", { name: "Change password" });
    const group = within(row("Appearance")).getByRole("group", { name: "Appearance" });
    expect(within(group).getAllByRole("radio").map((r) => r.closest("label")!.textContent)).toEqual(["System", "Light", "Dark"]);
    expect(within(group).getByRole("radio", { name: "System" })).toBeChecked();
    await user.click(within(group).getByRole("radio", { name: "Dark" }));
    expect(within(group).getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(document.documentElement).toHaveAttribute("data-mode", "dark");
    expect(localStorage.getItem("yasad.mode")).toBe("dark");
  });

  it("wraps a very long name instead of widening the page", async () => {
    mockApi(LOCAL);
    const name = "Ada".repeat(60);
    renderWithProviders(<Account user={{ ...ADA, name }} onProfileChanged={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1, name })).toHaveClass("wrap-anywhere");
    await screen.findByRole("button", { name: "Change password" });
  });
});

describe("Account, profile fields", () => {
  async function edit(label: "Name" | "E-mail") {
    const user = userEvent.setup();
    const toggle = await screen.findByRole("button", { name: `Edit: ${label}` });
    await user.click(toggle);
    return { user, toggle };
  }

  it("edits the name alone in its row, announces the save and gives the focus back to the row's button", async () => {
    const fetchMock = mockApi({ ...LOCAL, "PATCH /api/account": { status: 200, body: { user: { ...ADA, name: "Ada King" } } } });
    const onProfileChanged = vi.fn(async () => {});
    renderWithProviders(<Account user={ADA} onProfileChanged={onProfileChanged} />);
    const { user, toggle } = await edit("Name");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", "account-name-form");
    const name = within(row("Name")).getByRole("textbox", { name: "Name" });
    expect(name).toHaveFocus();
    expect(screen.queryByRole("textbox", { name: "E-mail" })).toBeNull();
    expect(screen.queryByLabelText("Current password")).toBeNull();
    await user.clear(name);
    await user.type(name, "Ada King");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(toggle).toHaveFocus());
    expect(onProfileChanged).toHaveBeenCalledOnce();
    expect(sentBody(fetchMock, 1)).toEqual({ name: "Ada King" });
    expect(getAnnouncer()).toHaveTextContent("Profile saved.");
    expect(document.querySelector('[data-slot="account-status"]')).toHaveTextContent("Profile saved.");
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
  });

  it("keeps one form open at a time", async () => {
    mockApi(LOCAL);
    renderWithProviders(<Account user={ADA} onProfileChanged={vi.fn()} />);
    const { user } = await edit("Name");
    await user.click(screen.getByRole("button", { name: "Edit: E-mail" }));
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    expect(within(row("E-mail")).getByRole("textbox", { name: "E-mail" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(screen.queryByRole("textbox", { name: "E-mail" })).toBeNull();
    expect(within(row("Password")).getByLabelText("Current password")).toHaveFocus();
  });

  it("asks for the current password when the e-mail changes, and sends it", async () => {
    const fetchMock = mockApi({ ...LOCAL, "PATCH /api/account": { status: 200, body: { user: ADA } } });
    renderWithProviders(<Account user={ADA} onProfileChanged={vi.fn(async () => {})} />);
    const { user, toggle } = await edit("E-mail");
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    const email = screen.getByRole("textbox", { name: "E-mail" });
    await user.clear(email);
    await user.type(email, "ada@lovelace.invalid");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    const field = screen.getByLabelText("Current password");
    expect(field).toHaveAccessibleDescription("Needed to change your e-mail. Error: Fill in this field.");
    expect(screen.getByRole("group", { name: "Check the highlighted fields." })).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.type(field, "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(toggle).toHaveFocus());
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
    const { user } = await edit("E-mail");
    const email = screen.getByRole("textbox", { name: "E-mail" });
    await user.clear(email);
    await user.type(email, "grace@example.invalid");
    await user.type(screen.getByLabelText("Current password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    const summary = await screen.findByRole("group", { name: "Check the highlighted fields." });
    expect(summary).toHaveFocus();
    await user.click(within(summary).getByRole("link", { name: "E-mail: This e-mail address is already used by another account." }));
    expect(email).toHaveFocus();
    expect(email).toHaveAttribute("aria-invalid", "true");

    await user.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(screen.getByLabelText("Current password")).toHaveAccessibleDescription(/The current password is not correct./));
  });

  it("names the field of each link when the same problem shows twice", async () => {
    mockApi(LOCAL);
    renderWithProviders(<Account user={ADA} onProfileChanged={vi.fn()} />);
    const { user } = await edit("E-mail");
    await user.clear(screen.getByRole("textbox", { name: "E-mail" }));
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    const summary = screen.getByRole("group", { name: "Check the highlighted fields." });
    expect(within(summary).getAllByRole("link").map((a) => a.textContent)).toEqual(["E-mail: Fill in this field.", "Current password: Fill in this field."]);
  });

  it("drops the current password problem once the e-mail is back to the saved one", async () => {
    mockApi(LOCAL);
    renderWithProviders(<Account user={ADA} onProfileChanged={vi.fn()} />);
    const { user } = await edit("E-mail");
    const email = screen.getByRole("textbox", { name: "E-mail" });
    await user.type(email, "x");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(within(screen.getByRole("group", { name: "Check the highlighted fields." })).getByRole("link")).toHaveTextContent("Current password");
    await user.type(email, "{Backspace}");
    expect(screen.queryByLabelText("Current password")).toBeNull();
    expect(screen.queryByRole("group", { name: "Check the highlighted fields." })).toBeNull();
  });

  it("closes like Cancel when nothing changed, and on Escape", async () => {
    const fetchMock = mockApi(LOCAL);
    renderWithProviders(<Account user={ADA} onProfileChanged={vi.fn()} />);
    const { user, toggle } = await edit("Name");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(toggle).toHaveFocus());
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    await user.click(toggle);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(toggle).toHaveFocus());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("says so when the server owns the profile after all", async () => {
    mockApi({ ...LOCAL, "PATCH /api/account": { status: 409, body: { error: { code: "profile_from_provider", message: "" } } } });
    renderWithProviders(<Account user={ADA} onProfileChanged={vi.fn()} />);
    const { user } = await edit("Name");
    await user.type(screen.getByRole("textbox", { name: "Name" }), " King");
    await act(() => user.click(screen.getByRole("button", { name: "Save profile" })));
    expect(await screen.findByRole("group", { name: /come from your identity provider/ })).toHaveFocus();
  });
});
