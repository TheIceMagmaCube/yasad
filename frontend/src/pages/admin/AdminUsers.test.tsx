import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminUser } from "../../api";
import { mockApi, renderWithProviders, sentBody } from "../../test-utils";
import { AdminUsers } from "./AdminUsers";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ME = { id: "ada", name: "Ada", email: "ada@example.invalid", role: "admin" };

const user = (fields: Partial<AdminUser> & { id: string; name: string }): AdminUser => ({
  email: `${fields.id}@example.invalid`,
  origin: "local",
  role: "user",
  roleSource: "local",
  roleOverride: null,
  disabled: false,
  mustChangePassword: false,
  groups: [],
  lastSignInAt: null,
  ...fields,
});

const ADA = user({ id: "ada", name: "Ada", role: "admin", lastSignInAt: "2026-10-15T09:00:00.000Z" });
const BOB = user({ id: "bob", name: "Bob", groups: [{ id: "g1", name: "Contractors", source: "local" }] });
const CAROL = user({ id: "carol", name: "Carol", origin: "oidc", roleSource: "provider" });

const card = (name: string) => screen.getByRole("heading", { name: new RegExp(`^${name}`) }).closest("li")!;

describe("AdminUsers", () => {
  it("lists the accounts with their origin, role, groups and last sign-in", async () => {
    mockApi({ "GET /api/admin/users": { status: 200, body: { users: [ADA, BOB, CAROL] } } });
    renderWithProviders(<AdminUsers me={ME} />);
    expect(await screen.findByRole("heading", { name: /^Ada/ })).toHaveTextContent("Ada (you)");
    expect(card("Bob")).toHaveTextContent("Contractors");
    expect(card("Bob")).toHaveTextContent("Never");
    expect(card("Carol")).toHaveTextContent("User (from the identity provider) · Identity provider");
    expect(within(card("Ada")).queryByRole("button", { name: "Delete Ada" })).toBeNull();
    expect(within(card("Carol")).queryByRole("button", { name: /Reset password/ })).toBeNull();
  });

  it("creates an account and shows its temporary password once, with a copy button", async () => {
    const fetchMock = mockApi({
      "GET /api/admin/users": [
        { status: 200, body: { users: [ADA] } },
        { status: 200, body: { users: [ADA, BOB] } },
      ],
      "POST /api/admin/users": { status: 201, body: { user: BOB, temporaryPassword: "abcdefghijkmnopqrstu" } },
    });
    renderWithProviders(<AdminUsers me={ME} />);
    const userEv = userEvent.setup();
    await userEv.click(await screen.findByRole("button", { name: "New user" }));
    await userEv.type(screen.getByLabelText("Name"), "Bob");
    await userEv.type(screen.getByLabelText("E-mail"), "bob@example.invalid");
    await userEv.click(screen.getByRole("button", { name: "Create the account" }));

    const panel = await screen.findByRole("region", { name: "Temporary password for Bob" });
    expect(panel).toHaveFocus();
    expect(panel).toHaveTextContent("abcdefghijkmnopqrstu");
    expect(sentBody(fetchMock, 1)).toEqual({ name: "Bob", email: "bob@example.invalid", role: "user" });
    await userEv.click(within(panel).getByRole("button", { name: "Copy" }));
    expect(await navigator.clipboard.readText()).toBe("abcdefghijkmnopqrstu");
    expect(within(panel).getByRole("status")).toHaveTextContent("Copied.");
    await userEv.click(within(panel).getByRole("button", { name: "Done" }));
    expect(screen.queryByText("abcdefghijkmnopqrstu")).toBeNull();
  });

  it("shows field errors from the API under the fields", async () => {
    mockApi({
      "GET /api/admin/users": { status: 200, body: { users: [ADA] } },
      "POST /api/admin/users": { status: 422, body: { error: { code: "invalid_input", message: "", fields: { email: "email_taken" } } } },
    });
    renderWithProviders(<AdminUsers me={ME} />);
    const userEv = userEvent.setup();
    await userEv.click(await screen.findByRole("button", { name: "New user" }));
    await userEv.click(screen.getByRole("button", { name: "Create the account" }));
    expect(await screen.findByText("This e-mail address is already used by another account.")).toBeInTheDocument();
  });

  it("forces the role of an OIDC account and disables it, sending only what changed", async () => {
    const fetchMock = mockApi({
      "GET /api/admin/users": { status: 200, body: { users: [ADA, CAROL] } },
      "PATCH /api/admin/users/carol": { status: 200, body: { user: CAROL } },
    });
    renderWithProviders(<AdminUsers me={ME} />);
    const userEv = userEvent.setup();
    await userEv.click(await screen.findByRole("button", { name: "Edit Carol" }));
    await userEv.selectOptions(screen.getByLabelText("Role"), "Always administrator");
    await userEv.click(screen.getByLabelText("Disabled"));
    await userEv.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Carol updated.");
    expect(sentBody(fetchMock, 1)).toEqual({ roleOverride: "admin", disabled: true });
  });

  it("offers no role or disable control on one's own account", async () => {
    mockApi({ "GET /api/admin/users": { status: 200, body: { users: [ADA] } } });
    renderWithProviders(<AdminUsers me={ME} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Edit Ada" }));
    expect(screen.queryByLabelText("Administrator")).toBeNull();
    expect(screen.queryByLabelText("Disabled")).toBeNull();
  });

  it("explains the refusal to remove the last local admin", async () => {
    mockApi({
      "GET /api/admin/users": { status: 200, body: { users: [ADA, BOB] } },
      "DELETE /api/admin/users/bob": { status: 409, body: { error: { code: "last_local_admin", message: "" } } },
    });
    renderWithProviders(<AdminUsers me={ME} />);
    const userEv = userEvent.setup();
    await userEv.click(await screen.findByRole("button", { name: "Delete Bob" }));
    expect(screen.getByRole("group", { name: /Delete Bob\?/ })).toHaveFocus();
    await userEv.click(screen.getByRole("button", { name: "Delete for good" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Keep at least one enabled local administrator");
  });

  it("warns that a deleted OIDC account comes back at its next sign-in", async () => {
    mockApi({ "GET /api/admin/users": { status: 200, body: { users: [ADA, CAROL] } } });
    renderWithProviders(<AdminUsers me={ME} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Delete Carol" }));
    expect(screen.getByText(/created again at its next sign-in/)).toBeInTheDocument();
  });

  it("resets a local password and shows the new one", async () => {
    mockApi({
      "GET /api/admin/users": { status: 200, body: { users: [ADA, BOB] } },
      "POST /api/admin/users/bob/password": { status: 200, body: { temporaryPassword: "zyxwvutsrqponmkjihgf" } },
    });
    renderWithProviders(<AdminUsers me={ME} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Reset password: Bob" }));
    expect(await screen.findByRole("region", { name: "Temporary password for Bob" })).toHaveTextContent("zyxwvutsrqponmkjihgf");
  });
});
