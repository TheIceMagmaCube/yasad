import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminUser } from "../../api";
import { getAnnouncer, mockApi, renderWithProviders, sentBody } from "../../test-utils";
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
const CAROL = user({
  id: "carol",
  name: "Carol",
  origin: "oidc",
  role: "admin",
  roleSource: "override",
  roleOverride: "admin",
  groups: [{ id: "o1", name: "Developers", source: "oidc" }],
});
const list = (...users: AdminUser[]) => ({ status: 200, body: { users } });
const error = (status: number, code: string, fields?: Record<string, string>) => ({ status, body: { error: { code, message: "", fields } } });

/** Return the row of a user, found by its title. */
const row = (name: string) => screen.getByText(name, { selector: "p[id$='-title']" }).closest("li")!;
const status = () => document.querySelector('[data-slot="toolbar-status"]')!;

async function renderPage(routes: Parameters<typeof mockApi>[0]) {
  const fetchMock = mockApi(routes);
  renderWithProviders(<AdminUsers me={ME} />);
  await screen.findByText("Ada", { selector: "p[id$='-title']" });
  return { fetchMock, userEv: userEvent.setup() };
}

describe("AdminUsers", () => {
  it("lists the accounts with their badges, last sign-in and groups, the provider's groups marked", async () => {
    await renderPage({ "GET /api/admin/users": list(ADA, BOB, CAROL, user({ id: "dan", name: "Dan", mustChangePassword: true, disabled: true })) });
    const ada = within(row("Ada"));
    expect(ada.getByText("You")).toBeInTheDocument();
    expect(ada.getByText("Administrator")).toBeInTheDocument();
    expect(ada.getByText("Local account")).toBeInTheDocument();
    expect(ada.getByText(/^Last sign-in on/)).toContainElement(row("Ada").querySelector("time[datetime='2026-10-15T09:00:00.000Z']"));
    expect(ada.queryByRole("button", { name: "Delete Ada" })).toBeNull();
    expect(ada.queryByRole("button", { name: /Reset password/ })).toBeNull();

    expect(within(row("Bob")).getByText("Never signed in")).toBeInTheDocument();
    expect(within(row("Bob")).getByText("Groups: Contractors")).toBeInTheDocument();
    const carol = within(row("Carol"));
    expect(carol.getByText("Identity provider")).toBeInTheDocument();
    expect(carol.getByText("Forced in YASAD")).toBeInTheDocument();
    expect(carol.getByText("Groups: Developers (identity provider)")).toBeInTheDocument();
    expect(carol.queryByRole("button", { name: /Reset password/ })).toBeNull();
    expect(within(row("Dan")).getByText("Temporary password")).toBeInTheDocument();
    expect(within(row("Dan")).getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("4 users")).toBeInTheDocument();
  });

  it("filters by name or e-mail, ignoring accents, and offers to clear a filter that hides everything", async () => {
    const { userEv } = await renderPage({ "GET /api/admin/users": list(ADA, BOB, user({ id: "helene", name: "Hélène" })) });
    await userEv.type(screen.getByLabelText("Filter by name or e-mail"), "helene");
    expect(screen.getByText("1 of 3 users")).toBeInTheDocument();
    expect(screen.queryByText("Bob", { selector: "p" })).toBeNull();

    await userEv.clear(screen.getByLabelText("Filter by name or e-mail"));
    await userEv.type(screen.getByLabelText("Filter by name or e-mail"), "nobody");
    await userEv.click(screen.getByRole("button", { name: "Clear the filter" }));
    await waitFor(() => expect(screen.getByLabelText("Filter by name or e-mail")).toHaveFocus());
    expect(screen.getByLabelText("Filter by name or e-mail")).toHaveValue("");
  });

  it("clears the filter on Escape without closing the open panel", async () => {
    const { userEv } = await renderPage({ "GET /api/admin/users": list(ADA, BOB) });
    await userEv.click(screen.getByRole("button", { name: "New user" }));
    await userEv.type(screen.getByLabelText("Filter by name or e-mail"), "bo");
    await userEv.keyboard("{Escape}");
    expect(screen.getByLabelText("Filter by name or e-mail")).toHaveValue("");
    expect(screen.getByRole("button", { name: "New user" })).toHaveAttribute("aria-expanded", "true");
    await userEv.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "New user" })).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(screen.getByRole("button", { name: "New user" })).toHaveFocus());
  });

  it("edits in the row: focus on the name, Escape back to Edit, Save shows the status line and focuses Edit", async () => {
    const renamed = { ...BOB, name: "Robert" };
    const { fetchMock, userEv } = await renderPage({
      "GET /api/admin/users": [list(ADA, BOB), list(ADA, renamed)],
      "PATCH /api/admin/users/bob": { status: 200, body: { user: renamed } },
    });
    const edit = screen.getByRole("button", { name: "Edit Bob" });
    await userEv.click(edit);
    expect(edit).toHaveAttribute("aria-expanded", "true");
    expect(within(row("Bob")).getByLabelText("Name")).toHaveFocus();
    await userEv.keyboard("{Escape}");
    await waitFor(() => expect(edit).toHaveFocus());
    expect(edit).toHaveAttribute("aria-expanded", "false");

    await userEv.click(edit);
    const name = within(row("Bob")).getByLabelText("Name");
    await userEv.clear(name);
    await userEv.type(name, "Robert");
    await userEv.click(within(row("Bob")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit Robert" })).toHaveFocus());
    expect(status()).toHaveTextContent("Robert updated.");
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Robert updated."));
    expect(sentBody(fetchMock, 1)).toEqual({ name: "Robert" });
  });

  it("closes an edit without changes like Cancel, without a request", async () => {
    const { fetchMock, userEv } = await renderPage({ "GET /api/admin/users": list(ADA, BOB) });
    await userEv.click(screen.getByRole("button", { name: "Edit Bob" }));
    await userEv.click(within(row("Bob")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit Bob" })).toHaveFocus());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps an edited row shown though it no longer matches the filter, until the filter changes", async () => {
    // An e-mail without the name, so the new name alone decides whether the row matches.
    const bob = { ...BOB, email: "b7@example.invalid" };
    const renamed = { ...bob, name: "Robert" };
    const { userEv } = await renderPage({
      "GET /api/admin/users": [list(ADA, bob), list(ADA, renamed)],
      "PATCH /api/admin/users/bob": { status: 200, body: { user: renamed } },
    });
    await userEv.type(screen.getByLabelText("Filter by name or e-mail"), "bob");
    await userEv.click(screen.getByRole("button", { name: "Edit Bob" }));
    const name = within(row("Bob")).getByLabelText("Name");
    await userEv.clear(name);
    await userEv.type(name, "Robert");
    await userEv.click(within(row("Bob")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit Robert" })).toHaveFocus());
    expect(row("Robert")).toBeInTheDocument();
    await userEv.type(screen.getByLabelText("Filter by name or e-mail"), "x");
    expect(screen.queryByText("Robert", { selector: "p" })).toBeNull();
  });

  it("shows email_taken in the summary, linked to the e-mail field marked invalid", async () => {
    const { userEv } = await renderPage({
      "GET /api/admin/users": list(ADA, BOB),
      "PATCH /api/admin/users/bob": error(422, "invalid_input", { email: "email_taken" }),
    });
    await userEv.click(screen.getByRole("button", { name: "Edit Bob" }));
    const email = within(row("Bob")).getByLabelText("E-mail");
    await userEv.clear(email);
    await userEv.type(email, "ada@example.invalid");
    await userEv.click(within(row("Bob")).getByRole("button", { name: "Save" }));
    const summary = await screen.findByRole("group", { name: "Check the highlighted fields." });
    expect(summary).toHaveFocus();
    expect(email).toHaveAttribute("aria-invalid", "true");
    await userEv.click(within(summary).getByRole("link", { name: /already used by another account/ }));
    expect(email).toHaveFocus();
  });

  it("shows last_local_admin as the title of the summary in the panel", async () => {
    const { userEv } = await renderPage({
      "GET /api/admin/users": list(ADA, user({ id: "eve", name: "Eve", role: "admin" })),
      "PATCH /api/admin/users/eve": error(409, "last_local_admin"),
    });
    await userEv.click(screen.getByRole("button", { name: "Edit Eve" }));
    await userEv.click(within(row("Eve")).getByLabelText("Administrator"));
    await userEv.click(within(row("Eve")).getByRole("button", { name: "Save" }));
    const summary = await within(row("Eve")).findByRole("group", { name: /Keep at least one enabled local administrator/ });
    expect(summary).toHaveFocus();
  });

  it("offers the role select to an OIDC account, and only a note when editing oneself", async () => {
    const { userEv } = await renderPage({ "GET /api/admin/users": list(ADA, CAROL) });
    await userEv.click(screen.getByRole("button", { name: "Edit Carol" }));
    expect(within(row("Carol")).getByLabelText("Role")).toHaveValue("admin");
    expect(within(row("Carol")).queryByLabelText("E-mail")).toBeNull();
    expect(within(row("Carol")).getByText("E-mail from the identity provider")).toBeInTheDocument();

    await userEv.click(screen.getByRole("button", { name: "Edit Ada" }));
    expect(within(row("Carol")).queryByLabelText("Role")).toBeNull();
    expect(within(row("Ada")).getByText("You cannot change your own role or disable your own account.")).toBeInTheDocument();
    expect(within(row("Ada")).queryByLabelText("Disabled")).toBeNull();
  });

  it("resets a password after confirmation, shows the secret focused, and starts over on a second reset", async () => {
    const { userEv } = await renderPage({
      "GET /api/admin/users": list(ADA, BOB),
      "POST /api/admin/users/bob/password": [
        { status: 200, body: { temporaryPassword: "first-temporary-pass" } },
        { status: 200, body: { temporaryPassword: "second-temporary-pas" } },
      ],
    });
    await userEv.click(screen.getByRole("button", { name: "Reset password for Bob" }));
    const confirm = within(row("Bob")).getByRole("group", { name: "Reset the password of Bob?" });
    expect(confirm).toHaveFocus();
    await userEv.click(within(confirm).getByRole("button", { name: "Reset" }));
    const secret = await screen.findByRole("region", { name: "Temporary password for Bob" });
    expect(secret).toHaveFocus();
    expect(within(secret).getByLabelText("Temporary password")).toHaveValue("first-temporary-pass");
    await userEv.click(within(secret).getByRole("button", { name: "Copy" }));
    expect(await navigator.clipboard.readText()).toBe("first-temporary-pass");
    expect(within(secret).getByText("Copied.")).toBeInTheDocument();

    await userEv.click(screen.getByRole("button", { name: "Reset password for Bob" }));
    await userEv.click(within(row("Bob")).getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(within(row("Bob")).getByLabelText("Temporary password")).toHaveValue("second-temporary-pas"));
    expect(within(row("Bob")).queryByText("Copied.")).toBeNull();
    await userEv.click(within(row("Bob")).getByRole("button", { name: "I have noted it" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reset password for Bob" })).toHaveFocus());
    expect(screen.queryByRole("region", { name: "Temporary password for Bob" })).toBeNull();
  });

  it("keeps a password not noted yet when another one is shown, and keeps its row through the filter", async () => {
    const { userEv } = await renderPage({
      "GET /api/admin/users": list(ADA, BOB, user({ id: "dan", name: "Dan" })),
      "POST /api/admin/users/bob/password": { status: 200, body: { temporaryPassword: "bob-temporary-passwd" } },
      "POST /api/admin/users/dan/password": { status: 200, body: { temporaryPassword: "dan-temporary-passwd" } },
    });
    await userEv.click(screen.getByRole("button", { name: "Reset password for Bob" }));
    await userEv.click(within(row("Bob")).getByRole("button", { name: "Reset" }));
    await screen.findByRole("region", { name: "Temporary password for Bob" });
    await userEv.click(screen.getByRole("button", { name: "Reset password for Dan" }));
    await userEv.click(within(row("Dan")).getByRole("button", { name: "Reset" }));
    expect(await screen.findByRole("region", { name: "Temporary password for Dan" })).toHaveFocus();
    expect(within(row("Bob")).getByLabelText("Temporary password")).toHaveValue("bob-temporary-passwd");

    await userEv.type(screen.getByLabelText("Filter by name or e-mail"), "ada");
    expect(screen.getByRole("region", { name: "Temporary password for Bob" })).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by name or e-mail")).toHaveFocus();
  });

  it("puts the message in place of a row deleted after its confirmation was cancelled, when the focus is in it", async () => {
    let release!: (res: Response) => void;
    const fetchMock = mockApi({ "GET /api/admin/users": list(ADA, BOB, CAROL) });
    renderWithProviders(<AdminUsers me={ME} />);
    await screen.findByText("Bob", { selector: "p[id$='-title']" });
    const userEv = userEvent.setup();
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    await userEv.click(screen.getByRole("button", { name: "Delete Bob" }));
    await userEv.click(screen.getByRole("button", { name: "Delete for good" }));
    await userEv.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete Bob" })).toHaveFocus());
    release(new Response(null, { status: 204 }));
    expect(await screen.findByRole("group", { name: "Bob deleted." })).toHaveFocus();
  });

  it("shows a creation error under the toolbar when the form was closed before the answer", async () => {
    let release!: (res: Response) => void;
    const fetchMock = mockApi({ "GET /api/admin/users": list(ADA) });
    renderWithProviders(<AdminUsers me={ME} />);
    await screen.findByText("Ada", { selector: "p[id$='-title']" });
    const userEv = userEvent.setup();
    await userEv.click(screen.getByRole("button", { name: "New user" }));
    await userEv.type(screen.getByLabelText("Name"), "Bob");
    await userEv.type(screen.getByLabelText("E-mail"), "ada@example.invalid");
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    await userEv.click(screen.getByRole("button", { name: "Create the account" }));
    await userEv.click(screen.getByRole("button", { name: "Cancel" }));
    release(new Response(JSON.stringify({ error: { code: "invalid_input", message: "", fields: { email: "email_taken" } } }), { status: 422 }));
    // Read once, as the alert appears: not announced a second time.
    expect(await screen.findByRole("alert")).toHaveTextContent("This e-mail address is already used by another account.");
    expect(getAnnouncer()).not.toHaveTextContent("already used");
    expect(fetchMock.mock.calls.filter((c) => c[1]?.method === "POST")).toHaveLength(1);
  });

  it("shows a creation error under the toolbar when the form was closed and opened again, leaving the new form alone", async () => {
    let release!: (res: Response) => void;
    const fetchMock = mockApi({ "GET /api/admin/users": list(ADA) });
    renderWithProviders(<AdminUsers me={ME} />);
    await screen.findByText("Ada", { selector: "p[id$='-title']" });
    const userEv = userEvent.setup();
    await userEv.click(screen.getByRole("button", { name: "New user" }));
    await userEv.type(screen.getByLabelText("Name"), "Bob");
    await userEv.type(screen.getByLabelText("E-mail"), "ada@example.invalid");
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    await userEv.click(screen.getByRole("button", { name: "Create the account" }));
    await userEv.keyboard("{Escape}");
    await userEv.click(screen.getByRole("button", { name: "New user" }));
    await userEv.type(screen.getByLabelText("Name"), "Zoe");
    release(new Response(JSON.stringify({ error: { code: "invalid_input", message: "", fields: { email: "email_taken" } } }), { status: 422 }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This e-mail address is already used by another account.");
    expect(screen.getByLabelText("Name")).toHaveValue("Zoe");
    expect(screen.queryByRole("group", { name: "Check the highlighted fields." })).toBeNull();
  });

  it("keeps a row whose request runs shown under a filter that hides it, so its form still reports the outcome", async () => {
    let release!: (res: Response) => void;
    const fetchMock = mockApi({ "GET /api/admin/users": list(ADA, BOB, CAROL) });
    renderWithProviders(<AdminUsers me={ME} />);
    await screen.findByText("Bob", { selector: "p[id$='-title']" });
    const userEv = userEvent.setup();
    await userEv.click(screen.getByRole("button", { name: "Edit Bob" }));
    await userEv.type(within(row("Bob")).getByLabelText("Name"), "!");
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    await userEv.click(within(row("Bob")).getByRole("button", { name: "Save" }));
    await userEv.type(screen.getByLabelText("Filter by name or e-mail"), "car");
    expect(row("Bob")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 users")).toBeInTheDocument();
    release(new Response(JSON.stringify({ error: { code: "last_local_admin", message: "" } }), { status: 409 }));
    expect(await within(row("Bob")).findByRole("group", { name: /Keep at least one enabled local administrator/ })).toBeInTheDocument();
  });

  it("keeps an error that came after Cancel shown in its row, though the filter hides the row", async () => {
    let release!: (res: Response) => void;
    const fetchMock = mockApi({ "GET /api/admin/users": list(ADA, BOB, CAROL) });
    renderWithProviders(<AdminUsers me={ME} />);
    await screen.findByText("Bob", { selector: "p[id$='-title']" });
    const userEv = userEvent.setup();
    await userEv.click(screen.getByRole("button", { name: "Edit Bob" }));
    await userEv.type(within(row("Bob")).getByLabelText("Name"), "!");
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    await userEv.click(within(row("Bob")).getByRole("button", { name: "Save" }));
    await userEv.keyboard("{Escape}");
    await userEv.type(screen.getByLabelText("Filter by name or e-mail"), "car");
    release(new Response(JSON.stringify({ error: { code: "last_local_admin", message: "" } }), { status: 409 }));
    // The error brings the row back, with the alert in it.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Keep at least one enabled local administrator/);
    expect(alert.closest("li")).toBe(row("Bob"));
  });

  it("sends only what was changed in a form opened again while an earlier save ran", async () => {
    let release!: (res: Response) => void;
    const robert = { ...BOB, name: "Robert" };
    const fetchMock = mockApi({ "GET /api/admin/users": [list(ADA, BOB), list(ADA, robert)] });
    renderWithProviders(<AdminUsers me={ME} />);
    await screen.findByText("Bob", { selector: "p[id$='-title']" });
    const userEv = userEvent.setup();
    await userEv.click(screen.getByRole("button", { name: "Edit Bob" }));
    const name = within(row("Bob")).getByLabelText("Name");
    await userEv.clear(name);
    await userEv.type(name, "Robert");
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    await userEv.click(within(row("Bob")).getByRole("button", { name: "Save" }));
    await userEv.keyboard("{Escape}");
    await userEv.click(screen.getByRole("button", { name: "Edit Bob" }));
    release(new Response(JSON.stringify({ user: robert }), { status: 200 }));
    await screen.findByText("Robert", { selector: "p[id$='-title']" });
    // The open form never touched the name: saving it sends nothing, so the rename stays.
    await userEv.click(within(row("Robert")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit Robert" })).toHaveFocus());
    expect(fetchMock.mock.calls.filter((c) => c[1]?.method === "PATCH")).toHaveLength(1);
  });

  it("closes a panel of a deleted row opened again meanwhile, so Escape on the message leaves the focus there", async () => {
    let release!: (res: Response) => void;
    const fetchMock = mockApi({ "GET /api/admin/users": [list(ADA, BOB, CAROL), list(ADA, CAROL)] });
    renderWithProviders(<AdminUsers me={ME} />);
    await screen.findByText("Bob", { selector: "p[id$='-title']" });
    const userEv = userEvent.setup();
    await userEv.click(screen.getByRole("button", { name: "Delete Bob" }));
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    await userEv.click(screen.getByRole("button", { name: "Delete for good" }));
    await userEv.keyboard("{Escape}");
    await userEv.click(screen.getByRole("button", { name: "Delete Bob" }));
    release(new Response(null, { status: 204 }));
    const tombstone = await screen.findByRole("group", { name: "Bob deleted." });
    await waitFor(() => expect(tombstone).toHaveFocus());
    expect(screen.queryByRole("group", { name: "Delete Bob?" })).toBeNull();
    await userEv.keyboard("{Escape}");
    expect(tombstone).toHaveFocus();
  });

  it("puts the message of a deletion where the row was when the focus was lost meanwhile", async () => {
    let release!: (res: Response) => void;
    const fetchMock = mockApi({ "GET /api/admin/users": [list(ADA, BOB, CAROL), list(ADA, CAROL)] });
    renderWithProviders(<AdminUsers me={ME} />);
    await screen.findByText("Bob", { selector: "p[id$='-title']" });
    const userEv = userEvent.setup();
    await userEv.click(screen.getByRole("button", { name: "Delete Carol" }));
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    await userEv.click(screen.getByRole("button", { name: "Delete for good" }));
    await userEv.keyboard("{Escape}");
    await userEv.click(screen.getByRole("button", { name: "Edit Bob" }));
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    release(new Response(null, { status: 204 }));
    expect(await screen.findByRole("group", { name: "Carol deleted." })).toHaveFocus();
  });

  it("keeps a row whose panel is folded under a filter that hides it, with the focus on its trigger", async () => {
    const { userEv } = await renderPage({ "GET /api/admin/users": list(ADA, BOB, CAROL) });
    const edit = screen.getByRole("button", { name: "Edit Bob" });
    await userEv.click(edit);
    await userEv.type(screen.getByLabelText("Filter by name or e-mail"), "car");
    await userEv.click(edit);
    expect(edit).toHaveAttribute("aria-expanded", "false");
    expect(edit).toHaveFocus();
    expect(row("Bob")).toBeInTheDocument();
  });

  it("leaves the focus in the filter when a save ends while the person types there", async () => {
    let release!: (res: Response) => void;
    const robert = { ...BOB, name: "Robert" };
    const fetchMock = mockApi({ "GET /api/admin/users": [list(ADA, BOB, CAROL), list(ADA, robert, CAROL)] });
    renderWithProviders(<AdminUsers me={ME} />);
    await screen.findByText("Bob", { selector: "p[id$='-title']" });
    const userEv = userEvent.setup();
    await userEv.click(screen.getByRole("button", { name: "Edit Bob" }));
    const name = within(row("Bob")).getByLabelText("Name");
    await userEv.clear(name);
    await userEv.type(name, "Robert");
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    await userEv.click(within(row("Bob")).getByRole("button", { name: "Save" }));
    const filterField = screen.getByLabelText("Filter by name or e-mail");
    await userEv.type(filterField, "ca");
    release(new Response(JSON.stringify({ user: robert }), { status: 200 }));
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Robert updated."));
    expect(filterField).toHaveFocus();
    await userEv.keyboard("rol");
    expect(filterField).toHaveValue("carol");
  });

  it("gives the focus to the new account when its creation removes the empty list the focus was in", async () => {
    let release!: (res: Response) => void;
    const fetchMock = mockApi({ "GET /api/admin/users": [list(ADA), list(ADA, BOB)] });
    renderWithProviders(<AdminUsers me={ME} />);
    await screen.findByText("Ada", { selector: "p[id$='-title']" });
    const userEv = userEvent.setup();
    await userEv.type(screen.getByLabelText("Filter by name or e-mail"), "zz");
    await userEv.click(screen.getByRole("button", { name: "New user" }));
    await userEv.type(screen.getByLabelText("Name"), "Bob");
    await userEv.type(screen.getByLabelText("E-mail"), "bob@example.invalid");
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    await userEv.click(screen.getByRole("button", { name: "Create the account" }));
    screen.getByRole("button", { name: "Clear the filter" }).focus();
    release(new Response(JSON.stringify({ user: BOB, temporaryPassword: "abcdefghijkmnopqrstu" }), { status: 201 }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit Bob" })).toHaveFocus());
  });

  it("selects the secret for Ctrl+C when the clipboard is not available", async () => {
    const { userEv } = await renderPage({
      "GET /api/admin/users": list(ADA, BOB),
      "POST /api/admin/users/bob/password": { status: 200, body: { temporaryPassword: "abcdefghijkmnopqrstu" } },
    });
    await userEv.click(screen.getByRole("button", { name: "Reset password for Bob" }));
    await userEv.click(within(row("Bob")).getByRole("button", { name: "Reset" }));
    const secret = await screen.findByRole("region", { name: "Temporary password for Bob" });
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    await userEv.click(within(secret).getByRole("button", { name: "Copy" }));
    const field = within(secret).getByLabelText("Temporary password") as HTMLInputElement;
    expect(field).toHaveFocus();
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 20]);
    expect(within(secret).getByText(/Copy is not available here/)).toBeInTheDocument();
    expect(field).toHaveAccessibleDescription(/press Ctrl\+C/);
  });

  it("creates an account, shows its secret in the new row though the filter hides it, and focuses its Edit button once noted", async () => {
    const { fetchMock, userEv } = await renderPage({
      "GET /api/admin/users": [list(ADA), list(ADA, BOB)],
      "POST /api/admin/users": { status: 201, body: { user: BOB, temporaryPassword: "abcdefghijkmnopqrstu" } },
    });
    await userEv.type(screen.getByLabelText("Filter by name or e-mail"), "ada");
    const add = screen.getByRole("button", { name: "New user" });
    await userEv.click(add);
    expect(add).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Name")).toHaveFocus();
    await userEv.type(screen.getByLabelText("Name"), "Bob");
    await userEv.type(screen.getByLabelText("E-mail"), "bob@example.invalid");
    await userEv.click(screen.getByRole("button", { name: "Create the account" }));

    const secret = await within(row("Bob")).findByRole("region", { name: "Temporary password for Bob" });
    expect(secret).toHaveFocus();
    expect(sentBody(fetchMock, 1)).toEqual({ name: "Bob", email: "bob@example.invalid", role: "user" });
    // The filter would hide the new account: its secret keeps the row, and the filter stays as typed.
    expect(screen.getByLabelText("Filter by name or e-mail")).toHaveValue("ada");
    expect(add).toHaveAttribute("aria-expanded", "false");
    await userEv.click(within(secret).getByRole("button", { name: "I have noted it" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit Bob" })).toHaveFocus());
  });

  it("checks the required fields of a new account in one pass, without a request", async () => {
    const { fetchMock, userEv } = await renderPage({ "GET /api/admin/users": list(ADA) });
    await userEv.click(screen.getByRole("button", { name: "New user" }));
    await userEv.click(screen.getByRole("button", { name: "Create the account" }));
    const summary = await screen.findByRole("group", { name: "Check the highlighted fields." });
    expect(summary).toHaveFocus();
    expect(within(summary).getAllByRole("link")).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("deletes after confirmation, the row replaced by a focused message", async () => {
    const { userEv } = await renderPage({
      "GET /api/admin/users": [list(ADA, BOB, CAROL), list(ADA, CAROL)],
      "DELETE /api/admin/users/bob": { status: 204 },
    });
    await userEv.click(screen.getByRole("button", { name: "Delete Bob" }));
    const confirm = within(row("Bob")).getByRole("group", { name: "Delete Bob?" });
    expect(confirm).toHaveFocus();
    await userEv.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete Bob" })).toHaveFocus());

    await userEv.click(screen.getByRole("button", { name: "Delete Bob" }));
    await userEv.click(screen.getByRole("button", { name: "Delete for good" }));
    const tombstone = await screen.findByRole("group", { name: "Bob deleted." });
    expect(tombstone).toHaveFocus();
    expect(tombstone.closest("li")).toBeInTheDocument();
    // Still in place once the list has reloaded without Bob.
    await waitFor(() => expect(screen.getByText("2 users")).toBeInTheDocument());
    expect(screen.getByRole("group", { name: "Bob deleted." })).toHaveFocus();
    await userEv.tab();
    expect(screen.getByRole("button", { name: "Edit Carol" })).toHaveFocus();
  });

  it("replaces a row the server no longer has by a focused message, then reloads", async () => {
    const { userEv } = await renderPage({
      "GET /api/admin/users": [list(ADA, BOB), list(ADA)],
      "PATCH /api/admin/users/bob": error(404, "not_found"),
    });
    await userEv.click(screen.getByRole("button", { name: "Edit Bob" }));
    await userEv.type(within(row("Bob")).getByLabelText("Name"), "!");
    await userEv.click(within(row("Bob")).getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("group", { name: "This item no longer exists." })).toHaveFocus();
    await waitFor(() => expect(screen.getByText("1 user")).toBeInTheDocument());
  });

  it("leaves the other rows usable while one waits", async () => {
    let release!: (res: Response) => void;
    const fetchMock = mockApi({ "GET /api/admin/users": list(ADA, BOB, CAROL) });
    renderWithProviders(<AdminUsers me={ME} />);
    await screen.findByText("Bob", { selector: "p[id$='-title']" });
    const userEv = userEvent.setup();
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    await userEv.click(screen.getByRole("button", { name: "Delete Bob" }));
    await userEv.click(screen.getByRole("button", { name: "Delete for good" }));
    expect(screen.getByRole("button", { name: "Deleting…" })).toHaveAttribute("aria-disabled", "true");
    await userEv.click(screen.getByRole("button", { name: "Edit Carol" }));
    expect(within(row("Carol")).getByLabelText("Name")).toHaveFocus();
    release(new Response(null, { status: 204 }));
    // The confirmation was closed: the deletion is only announced, without taking the focus.
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Bob deleted."));
    expect(within(row("Carol")).getByLabelText("Name")).toHaveFocus();
  });

  it("shows a load failure with Retry, the page heading kept", async () => {
    mockApi({ "GET /api/admin/users": [error(500, "internal"), list(ADA)] });
    renderWithProviders(<AdminUsers me={ME} />);
    expect(screen.getByRole("heading", { level: 1, name: "Users" })).toBeInTheDocument();
    expect(await screen.findByText("The users could not be loaded.")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Ada", { selector: "p[id$='-title']" })).toBeInTheDocument();
  });

  it("keeps the status line mounted while loading", () => {
    mockApi({ "GET /api/admin/users": list(ADA) });
    renderWithProviders(<AdminUsers me={ME} />);
    expect(status()).toBeInTheDocument();
    expect(document.querySelector('[data-slot="list-skeleton"]')).toHaveAttribute("aria-hidden", "true");
  });
});
