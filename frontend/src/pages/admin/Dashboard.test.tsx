import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminCategory, AdminLink } from "../../api";
import type { Routes } from "../../test-utils";
import { group, groupsAnswer, pageHeading, person, renderAdmin, usersAnswer } from "./people/testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const link = (fields: Partial<AdminLink> & { id: string }): AdminLink => ({
  categoryId: "tools",
  title: fields.id,
  description: "",
  url: `https://${fields.id}.example.invalid`,
  icon: null,
  iconKnown: false,
  keywords: [],
  active: true,
  check: false,
  status: null,
  groups: ["@authenticated"],
  revision: 1,
  ...fields,
});
const category = (fields: Partial<AdminCategory> & { id: string }): AdminCategory => ({ title: fields.id, groups: ["@authenticated"], revision: 1, links: [], ...fields });

const ADA = person({ id: "ada", name: "Ada", role: "admin" });
const DAN = person({ id: "dan", name: "Dan", mustChangePassword: true });
const EVE = person({ id: "eve", name: "Eve", mustChangePassword: true });
const HELENE = person({ id: "helene", name: "Hélène", disabled: true });
const EVERYONE = group({ id: "system:everyone", name: "everyone", source: "system" });
const AUTHENTICATED = group({ id: "system:authenticated", name: "authenticated", source: "system" });
const FINANCE = group({ id: "g1", name: "Finance", memberIds: ["ada"] });
const REVIEWERS = group({ id: "g2", name: "Reviewers" });
const AUDITORS = group({ id: "g3", name: "Auditors" });
// Named by the catalog, never received: worth a look. Not named: nothing to check.
const STAFF = group({ id: "o1", name: "staff", source: "oidc", seenAt: null });
const IDLE = group({ id: "o2", name: "idle", source: "oidc", seenAt: null });
const DEVS = group({ id: "o3", name: "devs", source: "oidc", seenAt: "2026-10-01T00:00:00.000Z" });

const CATALOG = [
  category({
    id: "tools",
    links: [
      link({ id: "wiki", icon: "wikipedia", iconKnown: true }),
      link({ id: "mail", icon: "no-such-icon", groups: [] }),
      link({ id: "crm", icon: "also-unknown", groups: ["oidc:staff", "oidc:devs"] }),
    ],
  }),
  category({ id: "empty", groups: [] }),
];

type Answer = Routes[string];
const routes = (fields: { users?: Answer; groups?: Answer; categories?: AdminCategory[] } = {}): Routes => ({
  "GET /api/admin/users": fields.users ?? usersAnswer(ADA, DAN, EVE, HELENE),
  "GET /api/admin/groups": fields.groups ?? groupsAnswer(EVERYONE, AUTHENTICATED, FINANCE, REVIEWERS, AUDITORS, STAFF, IDLE, DEVS),
  "GET /api/admin/catalog/state": { status: 200, body: { managedByFile: false, categories: 2, links: 3, groups: 4 } },
  "GET /api/admin/categories": { status: 200, body: { categories: fields.categories ?? CATALOG } },
});

const todoList = async () => within((await screen.findByRole("heading", { level: 2, name: "To do" })).parentElement!).findByRole("list");
const todoLinks = async () => within(await todoList()).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]);

describe("Dashboard", () => {
  it("opens on /admin, first in the section links, with the four counters", async () => {
    renderAdmin("/admin", routes());
    expect(pageHeading()).toHaveTextContent("Dashboard");
    const nav = screen.getByRole("navigation", { name: "Administration" });
    expect(within(nav).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Dashboard", "/admin"],
      ["People", "/admin/users"],
      ["Links", "/admin/links"],
      ["History", "/admin/history"],
    ]);
    expect(within(nav).getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");

    await screen.findByText("To do");
    await within(await todoList()).findAllByRole("link");
    const counters = within(document.querySelector<HTMLElement>("[data-slot=dashboard-counters]")!).getAllByRole("link");
    // The two built-in groups are no group an admin made or received.
    expect(counters.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["People4", "/admin/users"],
      ["Groups6", "/admin/users"],
      ["Categories2", "/admin/links"],
      ["Links3", "/admin/links"],
    ]);
  });

  it("lists each thing to look at as a link to the list filtered on it", async () => {
    renderAdmin("/admin", routes());
    expect(await todoLinks()).toEqual([
      ["2 temporary passwords not used yet", "/admin/users?state=temporary"],
      ["1 disabled account", "/admin/users?state=disabled"],
      ["2 local groups without members", "/admin/users"],
      ["2 items without a group", "/admin/links?state=noGroup"],
      ["2 unknown icons", "/admin/links?state=unknownIcon"],
      ["1 typed group never received from the identity provider: check the name", "/admin/links?state=neverReceived"],
    ]);
  });

  it("opens the page of the one empty local group, and leaves out what counts zero", async () => {
    renderAdmin(
      "/admin",
      routes({
        users: usersAnswer(ADA, HELENE),
        groups: groupsAnswer(EVERYONE, FINANCE, REVIEWERS, DEVS),
        categories: [category({ id: "tools", links: [link({ id: "wiki", icon: "wikipedia", iconKnown: true, groups: ["oidc:devs"] })] })],
      }),
    );
    expect(await todoLinks()).toEqual([
      ["1 disabled account", "/admin/users?state=disabled"],
      ["1 local group without members", "/admin/groups/g2"],
    ]);
  });

  it("says in one line when there is nothing to do", async () => {
    renderAdmin(
      "/admin",
      routes({ users: usersAnswer(ADA), groups: groupsAnswer(EVERYONE, FINANCE), categories: [category({ id: "tools", links: [link({ id: "wiki" })] })] }),
    );
    expect(await screen.findByText("Nothing to do.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /without|unknown|temporary|disabled|never/ })).toBeNull();
  });

  it("shows a load failure with Retry", async () => {
    const { user } = renderAdmin("/admin", { ...routes(), "GET /api/admin/categories": [{ status: 500, body: {} }, { status: 200, body: { categories: CATALOG } }] });
    expect(await screen.findByText("Something went wrong. Try again.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "2 unknown icons" })).toBeInTheDocument();
  });

  it("draws the hero band as decoration: hidden from assistive technologies and in forced colors", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    renderAdmin("/admin", routes());
    const hero = document.querySelector<HTMLElement>("[data-slot=admin-hero]")!;
    expect(hero).toHaveAttribute("aria-hidden", "true");
    expect(hero).toHaveClass("forced-colors:hidden");
    expect(hero.querySelector("[data-slot=pixel-scene]")).not.toBeNull();
    expect(await within(hero).findByText("3 links, zero broken bookmark. So far.")).toBeInTheDocument();
    // Hidden, so no line of it reaches the accessibility tree.
    expect(screen.queryByText("3 links, zero broken bookmark. So far.", { ignore: "[aria-hidden=true] *" })).toBeNull();
  });
});
