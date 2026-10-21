import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectFocused, sentBody } from "../../../test-utils";
import { CHECKS } from "../links/testing";
import { apiError, group, groupsAnswer, person, renderAdmin, usersAnswer } from "./testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADA = person({ id: "ada", name: "Ada", role: "admin" });
const BOB = person({ id: "bob", name: "Bob" });
const FINANCE = group({ id: "g1", name: "Finance" });
const STAFF = group({ id: "g2", name: "Staff" });
const ZOE = person({ id: "zoe", name: "Zoé", mustChangePassword: true });

const routes = (extra = {}) => ({
  "GET /api/admin/users": usersAnswer(ADA, BOB),
  "GET /api/admin/groups": groupsAnswer(FINANCE, STAFF),
  "GET /api/admin/categories": { status: 200, body: { categories: [] } },
  "GET /api/admin/catalog/state": { status: 200, body: { managedByFile: false, categories: 0, links: 0, groups: 0, checks: CHECKS } },
  ...extra,
});

const stepHeading = () => screen.getByRole("heading", { level: 2 });
const next = (user: ReturnType<typeof renderAdmin>["user"]) => user.click(screen.getByRole("button", { name: "Next" }));
const currentStep = () => screen.getByRole("list", { name: "Steps" }).querySelector('[aria-current="step"]');

/** Go through the identity step of a new person. */
async function fillIdentity(user: ReturnType<typeof renderAdmin>["user"]) {
  await next(user);
  await user.type(screen.getByLabelText("Name"), "Zoé");
  await user.type(screen.getByLabelText("E-mail"), "zoe@example.invalid");
  await next(user);
}

describe("AddPeople", () => {
  it("opens from the list's Add link on the type question", async () => {
    const { user } = renderAdmin("/admin/users", routes());
    await screen.findByRole("table");
    await user.click(screen.getByRole("link", { name: "Add" }));
    expect(location.pathname).toBe("/admin/users/new");
    await expectFocused(() => screen.getByRole("heading", { level: 1, name: "Add" }));
    expect(stepHeading()).toHaveTextContent("What do you want to add?");
    expect(screen.getByRole("radio", { name: /Person/ })).toBeChecked();
    expect(currentStep()).toHaveTextContent("Step 1 of 5: Type");
  });

  it("goes step by step, the focus on each step's heading, checking the identity before going on", async () => {
    const { fetchMock, user } = renderAdmin("/admin/users/new", routes());
    await screen.findByRole("heading", { level: 2, name: "What do you want to add?" });
    await next(user);
    expect(stepHeading()).toHaveTextContent("Identity");
    expect(stepHeading()).toHaveFocus();
    expect(currentStep()).toHaveTextContent("Step 2 of 5: Identity");
    expect(screen.getByRole("list", { name: "Steps" })).toHaveTextContent("Type, done");

    await next(user);
    await expectFocused(() => screen.getByRole("group", { name: "Check the highlighted fields." }));
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("E-mail")).toHaveAttribute("aria-invalid", "true");
    expect(stepHeading()).toHaveTextContent("Identity");

    await user.type(screen.getByLabelText("Name"), "Zoé");
    await user.type(screen.getByLabelText("E-mail"), "zoe@example.invalid");
    await next(user);
    expect(stepHeading()).toHaveTextContent("Role");
    expect(stepHeading()).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(stepHeading()).toHaveTextContent("Identity");
    expect(screen.getByLabelText("Name")).toHaveValue("Zoé");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("sums up before creating, creates the account with its groups, and shows the temporary password once", async () => {
    const { fetchMock, user } = renderAdmin(
      "/admin/users/new",
      routes({
        "POST /api/admin/users": { status: 201, body: { user: ZOE, temporaryPassword: "zoe-temporary-pass" } },
        "PUT /api/admin/groups/g2/members/zoe": { status: 204 },
        "GET /api/admin/users": [usersAnswer(ADA, BOB), usersAnswer(ADA, BOB, ZOE)],
      }),
    );
    await screen.findByRole("heading", { level: 2, name: "What do you want to add?" });
    await fillIdentity(user);
    await user.click(screen.getByRole("radio", { name: /Administrator/ }));
    await next(user);
    expect(stepHeading()).toHaveTextContent("Groups");
    await user.click(screen.getByRole("checkbox", { name: "Staff" }));
    await next(user);

    expect(stepHeading()).toHaveTextContent("Summary");
    const recap = document.querySelector("form dl")!;
    expect(Array.from(recap.querySelectorAll("dt, dd")).map((el) => el.textContent)).toEqual([
      "Name",
      "Zoé",
      "E-mail",
      "zoe@example.invalid",
      "Role",
      "Administrator",
      "Groups",
      "Staff",
    ]);
    await user.click(screen.getByRole("button", { name: "Create the account" }));

    const secret = await screen.findByRole("region", { name: "Temporary password for Zoé" });
    expect(secret).toHaveFocus();
    expect(within(secret).getByLabelText("Temporary password")).toHaveValue("zoe-temporary-pass");
    const create = fetchMock.mock.calls.findIndex(([path, init]) => path === "/api/admin/users" && init?.method === "POST");
    expect(sentBody(fetchMock, create)).toEqual({ name: "Zoé", email: "zoe@example.invalid", role: "admin" });
    expect(fetchMock.mock.calls.map(([path, init]) => `${init?.method ?? "GET"} ${path}`)).toContain("PUT /api/admin/groups/g2/members/zoe");

    await user.click(within(secret).getByRole("button", { name: "I have noted it" }));
    expect(location.pathname).toBe("/admin/users");
    await waitFor(() => expect(screen.getByRole("link", { name: "Zoé" })).toHaveFocus());
    expect(document.querySelector('[data-slot="toolbar-status"]')).toHaveTextContent("Account of Zoé created.");
    // Noted: the list recalls no password.
    expect(screen.queryByText(/not noted/)).toBeNull();
  });

  it("says which groups the new account could not be added to, the password still shown", async () => {
    const { user } = renderAdmin(
      "/admin/users/new",
      routes({
        "POST /api/admin/users": { status: 201, body: { user: ZOE, temporaryPassword: "zoe-temporary-pass" } },
        "PUT /api/admin/groups/g1/members/zoe": apiError(500, "internal"),
        "PUT /api/admin/groups/g2/members/zoe": { status: 204 },
      }),
    );
    await screen.findByRole("heading", { level: 2, name: "What do you want to add?" });
    await fillIdentity(user);
    await next(user);
    await user.click(screen.getByRole("checkbox", { name: "Finance" }));
    await user.click(screen.getByRole("checkbox", { name: "Staff" }));
    await next(user);
    await user.click(screen.getByRole("button", { name: "Create the account" }));

    const failure = await screen.findByRole("group", { name: /could not be added to: Finance\./ });
    expect(failure).toHaveFocus();
    expect(failure).toHaveTextContent("The account was created, but could not be added to: Finance. Add these groups on its page.");
    expect(screen.getByRole("region", { name: "Temporary password for Zoé" })).toBeInTheDocument();
    expect(screen.getByLabelText("Temporary password")).toHaveValue("zoe-temporary-pass");

    // The person's page shows the groups that did go through, and still the password until noted.
    await user.click(screen.getByRole("link", { name: "Back to People" }));
    await user.click(await screen.findByRole("link", { name: "Zoé" }));
    expect(await screen.findByRole("checkbox", { name: "Staff" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Finance" })).not.toBeChecked();
    expect(screen.getByRole("region", { name: "Temporary password for Zoé" })).toBeInTheDocument();
  });

  it("goes back to the identity step with the error when the account cannot be created", async () => {
    const { user } = renderAdmin("/admin/users/new", routes({ "POST /api/admin/users": apiError(422, "invalid_input", { email: "email_taken" }) }));
    await screen.findByRole("heading", { level: 2, name: "What do you want to add?" });
    await fillIdentity(user);
    await next(user);
    await next(user);
    await user.click(screen.getByRole("button", { name: "Create the account" }));
    await expectFocused(() => screen.getByRole("group", { name: "Check the highlighted fields." }));
    expect(stepHeading()).toHaveTextContent("Identity");
    expect(screen.getByLabelText("E-mail")).toHaveAttribute("aria-invalid", "true");
  });

  it("creates a group with its members, from /admin/groups/new, and goes back to the list saying so", async () => {
    const created = group({ id: "g3", name: "Interns" });
    const { fetchMock, user } = renderAdmin(
      "/admin/groups/new",
      routes({ "POST /api/admin/groups": { status: 201, body: { group: created } }, "PUT /api/admin/groups/g3/members/bob": { status: 204 } }),
    );
    await screen.findByRole("heading", { level: 2, name: "What do you want to add?" });
    expect(screen.getByRole("radio", { name: /Group/ })).toBeChecked();
    expect(currentStep()).toHaveTextContent("Step 1 of 4: Type");
    await next(user);
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Interns");
    await next(user);
    expect(stepHeading()).toHaveTextContent("Members");
    await user.click(screen.getByRole("checkbox", { name: "Bob" }));
    await next(user);
    expect(stepHeading()).toHaveTextContent("Summary");
    await user.click(screen.getByRole("button", { name: "Create the group" }));
    await waitFor(() => expect(location.pathname).toBe("/admin/users"));
    expect(document.querySelector('[data-slot="toolbar-status"]')).toHaveTextContent("Group Interns created.");
    const create = fetchMock.mock.calls.findIndex(([path, init]) => path === "/api/admin/groups" && init?.method === "POST");
    expect(sentBody(fetchMock, create)).toEqual({ name: "Interns" });
  });

  it("says which people a new group could not get, with a way to its page", async () => {
    const created = group({ id: "g3", name: "Interns" });
    const { user } = renderAdmin(
      "/admin/groups/new",
      routes({
        "POST /api/admin/groups": { status: 201, body: { group: created } },
        "PUT /api/admin/groups/g3/members/ada": { status: 204 },
        "PUT /api/admin/groups/g3/members/bob": apiError(500, "internal"),
      }),
    );
    await screen.findByRole("heading", { level: 2, name: "What do you want to add?" });
    await next(user);
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Interns");
    await next(user);
    await user.click(screen.getByRole("checkbox", { name: "Ada" }));
    await user.click(screen.getByRole("checkbox", { name: "Bob" }));
    await next(user);
    await user.click(screen.getByRole("button", { name: "Create the group" }));

    const failure = await screen.findByRole("group", { name: "The group Interns was created, but these people could not be added: Bob." });
    expect(failure).toHaveFocus();
    expect(location.pathname).toBe("/admin/groups/new");
    await user.click(screen.getByRole("link", { name: "Open Interns" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Interns" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Ada" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Bob" })).not.toBeChecked();
  });
});
