import { readFileSync } from "node:fs";

import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

import {
  addGroup,
  addLocalUser,
  addOidcUser,
  addUsers,
  announcer,
  expectAccessible,
  expectNoHorizontalScroll,
  MODES,
  open,
  setLinkStatus,
  signInAsAdmin,
  THEMES,
  watchCsp,
  WIDTHS,
} from "./helpers";

test.describe.configure({ mode: "serial" });

const GRACE = { id: "adm-grace", name: "Grace Hopper", email: "grace@example.invalid", password: "grace's first passphrase" };
const LINUS = { id: "adm-linus", name: "Linus Torvalds", email: "linus@example.invalid", password: "linus's first passphrase" };
const MARGARET = { id: "adm-margaret", name: "Margaret Hamilton", email: "margaret@example.invalid", password: "margaret's passphrase" };
// Sorts before the administrator, Ada Lovelace, so the row after it is known whatever other specs added.
const TEMP = { id: "adm-temp", name: "Abel Temp", email: "temp@example.invalid", password: "a temporary account" };
const KEN = { id: "adm-ken", name: "Ken Thompson", email: "ken@example.invalid" };
// Holds a temporary password, so the dashboard has something to do and the people table a state to filter on.
const BARBARA = { id: "adm-barbara", name: "Barbara Liskov", email: "barbara@example.invalid", password: "barbara's temporary one", mustChangePassword: true };

const EXAMPLE = readFileSync("../docs/catalog.example.yaml", "utf8");

/** Drop the `check:` lines of a catalog file. */
function withoutChecks(yaml: string): string {
  return yaml.replace(/^[ \t]*check:.*\n/gm, "");
}

// The example checks a real host (Jira): imported as is, the server's scheduler would contact it within a minute.
// The tests import it unchecked, and only preview it untouched.
const CATALOG = withoutChecks(EXAMPLE);
const CHECKS = readFileSync("e2e/fixtures/checks.yaml", "utf8");
const HOUR = 60 * 60_000;
/** A catalog checking a private address: its preview warns, and the tests never import it. */
const CHECKED_LAB = `version: 1
categories:
  - id: lab
    title: Lab
    groups: ["@authenticated"]
    links:
      - id: nas
        title: NAS
        url: http://10.0.0.5
        groups: ["@authenticated"]
        check: true
`;

/**
 * Replace the catalog with the links of `checks.yaml` and give them stored results: up, down, up but too old
 * (status unknown) and checked but never run (status unknown). Later imports of the example replace it again.
 */
async function importStatusLinks(request: APIRequestContext): Promise<void> {
  await importCatalog(request, CHECKS);
  const now = Date.now();
  setLinkStatus([
    { linkId: "status-up", state: "up", httpStatus: 200, checkedAt: now },
    { linkId: "status-down", state: "down", reason: "http_error", httpStatus: 502, checkedAt: now },
    { linkId: "status-old", state: "up", httpStatus: 200, checkedAt: now - 48 * HOUR },
    { linkId: "status-new", state: null, checkedAt: null },
  ]);
}

/** The table row of the link titled `title`. */
function rowOf(page: Page, title: string) {
  return page.getByRole("link", { name: title, exact: true }).locator("xpath=ancestor::tr");
}

/** Import a catalog through the admin API: preview, then apply with the preview's base version. */
async function importCatalog(request: APIRequestContext, yaml: string): Promise<void> {
  const preview = await request.post("/api/admin/catalog", { data: { yaml, dryRun: true } });
  expect(preview.ok(), await preview.text()).toBe(true);
  const { baseVersion } = (await preview.json()) as { baseVersion: string };
  const applied = await request.post("/api/admin/catalog", { data: { yaml, dryRun: false, baseVersion } });
  expect(applied.ok(), await applied.text()).toBe(true);
}

/** Check the page with axe and for sideways scrolling. */
async function expectClean(page: Page, label: string): Promise<void> {
  await expectAccessible(page, label);
  await expectNoHorizontalScroll(page, label);
}

test.beforeAll(async () => {
  await addLocalUser(GRACE);
  await addLocalUser(LINUS);
  await addLocalUser(MARGARET);
  await addLocalUser(TEMP);
  await addLocalUser(BARBARA);
  addOidcUser(KEN);
  addGroup({ id: "adm-staff", name: "Staff", memberIds: [GRACE.id, KEN.id, LINUS.id] });
  addGroup({ id: "adm-reviewers", name: "Reviewers" });
  addGroup({ id: "adm-engineering", name: "Engineering", source: "oidc", memberIds: [KEN.id] });
});

test("the dashboard is accessible, and its items open the list filtered on them, in every theme, mode and width", async ({ page }) => {
  test.setTimeout(300_000);
  await signInAsAdmin(page);
  // The example as shipped, `check:` included, still parses: a preview only, nothing stored.
  const preview = await page.request.post("/api/admin/catalog", { data: { yaml: EXAMPLE, dryRun: true } });
  expect(preview.ok(), await preview.text()).toBe(true);
  await importCatalog(page.request, CATALOG);
  for (const theme of THEMES) {
    for (const mode of MODES) {
      for (const width of WIDTHS) {
        const label = `dashboard (${theme}, ${mode}, ${width}px)`;
        const csp = watchCsp(page);
        await open(page, "/admin", theme, mode, width);
        await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
        const temporary = page.getByRole("link", { name: /temporary passwords? not used yet/ });
        await expect(temporary).toBeVisible();
        await expectClean(page, label);

        await temporary.click();
        await expect(page).toHaveURL(/\/admin\/users\?state=temporary$/);
        await expect(page.getByText("Filter: Temporary password")).toBeVisible();
        await expect(page.getByRole("link", { name: BARBARA.name, exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: GRACE.name, exact: true })).toBeHidden();
        await expectClean(page, `${label}, people narrowed to a state`);
        await page.getByRole("button", { name: "Show all" }).click();
        await expect(page.getByLabel("Filter by name or e-mail")).toBeFocused();
        await expect(page).toHaveURL(/\/admin\/users$/);
        expect(csp).toEqual([]);
      }
    }
  }
});

test("the people pages are accessible in each of their states, in every theme, mode and width", async ({ page }) => {
  test.setTimeout(300_000);
  await signInAsAdmin(page);
  for (const theme of THEMES) {
    for (const mode of MODES) {
      for (const width of WIDTHS) {
        const label = `people (${theme}, ${mode}, ${width}px)`;
        const csp = watchCsp(page);
        await open(page, "/admin/users", theme, mode, width);
        await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
        await expect(page.getByRole("link", { name: GRACE.name, exact: true })).toBeVisible();
        await expectClean(page, label);
        await page.getByLabel("Group", { exact: true }).selectOption({ label: "Staff (3)" });
        await expect(page.getByRole("link", { name: "Manage the group" })).toBeVisible();
        await expectClean(page, `${label}, narrowed to a group`);

        await open(page, "/admin/users/new", theme, mode, width);
        await expect(page.getByRole("heading", { level: 2, name: "What do you want to add?" })).toBeVisible();
        await expectClean(page, `${label}, add wizard`);
        await page.getByRole("button", { name: "Next" }).click();
        await page.getByRole("button", { name: "Next" }).click();
        await expect(page.getByRole("group", { name: "Check the highlighted fields." })).toBeFocused();
        await expectClean(page, `${label}, add wizard with errors`);

        await open(page, `/admin/users/${LINUS.id}`, theme, mode, width);
        await expect(page.getByRole("heading", { level: 1, name: LINUS.name })).toBeVisible();
        await expectClean(page, `${label}, person page`);
        await page.getByRole("button", { name: "Reset password" }).click();
        await expect(page.getByRole("group", { name: `Reset the password of ${LINUS.name}?` })).toBeFocused();
        await expectClean(page, `${label}, reset confirmation`);
        await page.getByRole("button", { name: "Reset", exact: true }).click();
        const secret = page.getByRole("region", { name: `Temporary password for ${LINUS.name}` });
        await expect(secret).toBeFocused();
        await expectClean(page, `${label}, temporary password`);
        await secret.getByRole("button", { name: "I have noted it" }).click();
        await expect(page.getByRole("button", { name: "Reset password" })).toBeFocused();
        await page.getByRole("button", { name: `Delete ${LINUS.name}` }).click();
        await expect(page.getByRole("group", { name: `Delete ${LINUS.name}?` })).toBeFocused();
        await expectClean(page, `${label}, delete confirmation`);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("button", { name: `Delete ${LINUS.name}` })).toBeFocused();

        await open(page, `/admin/users/${KEN.id}`, theme, mode, width);
        await expect(page.getByRole("heading", { level: 1, name: KEN.name })).toBeVisible();
        await expectClean(page, `${label}, provider person page`);

        await open(page, "/admin/groups/adm-staff", theme, mode, width);
        await expect(page.getByRole("checkbox", { name: GRACE.name })).toBeChecked();
        await expectClean(page, `${label}, group page`);
        await page.getByRole("button", { name: "Rename" }).click();
        await expect(page.getByLabel("Name", { exact: true })).toBeFocused();
        await page.getByLabel("Name", { exact: true }).fill("Reviewers");
        await page.keyboard.press("Enter");
        await expect(page.getByRole("group", { name: "Check the highlighted fields." })).toBeFocused();
        await expectClean(page, `${label}, rename with errors`);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("button", { name: "Rename" })).toBeFocused();

        await open(page, "/admin/groups/adm-engineering", theme, mode, width);
        await expect(page.getByRole("link", { name: KEN.name })).toBeVisible();
        await expectClean(page, `${label}, provider group page`);
        expect(csp).toEqual([]);
      }
    }
  }
});

test("the links pages are accessible in each of their states, in every theme, mode and width", async ({ page }) => {
  test.setTimeout(300_000);
  await signInAsAdmin(page);
  for (const theme of THEMES) {
    for (const mode of MODES) {
      for (const width of WIDTHS) {
        const label = `links (${theme}, ${mode}, ${width}px)`;
        const csp = watchCsp(page);
        await importCatalog(page.request, CATALOG);
        await open(page, "/admin/links", theme, mode, width);
        await expect(page.getByRole("table", { name: "Links of Everyday" })).toBeVisible();
        await expectClean(page, label);
        await open(page, "/admin/links?state=inactive", theme, mode, width);
        await expect(page.getByText("Filter: Inactive")).toBeVisible();
        await expectClean(page, `${label}, narrowed to a state`);

        await open(page, "/admin/links", theme, mode, width);
        await page.getByRole("button", { name: "Reorder" }).click();
        await expect(page.getByRole("button", { name: "Move up the category Everyday" })).toHaveAttribute("aria-disabled", "true");
        await expectClean(page, `${label}, reorder categories`);
        await page.getByRole("button", { name: "Links", exact: true }).click();
        await expect(page.getByRole("button", { name: "Move down the link Jira" })).toBeVisible();
        await expectClean(page, `${label}, reorder links`);

        await open(page, "/admin/links/new", theme, mode, width);
        await expect(page.getByRole("heading", { level: 2, name: "What do you want to add?" })).toBeVisible();
        await expectClean(page, `${label}, add wizard`);
        await page.getByRole("button", { name: "Next" }).click();
        await page.getByRole("button", { name: "Next" }).click();
        await expect(page.getByRole("group", { name: "Check the highlighted fields." })).toBeFocused();
        await expectClean(page, `${label}, add wizard with errors`);
        await open(page, "/admin/links/categories/new", theme, mode, width);
        await page.getByRole("button", { name: "Next" }).click();
        await page.getByRole("textbox", { name: "Title" }).fill("Shelf");
        await page.getByRole("button", { name: "Next" }).click();
        await expect(page.getByRole("checkbox", { name: "@everyone" })).toBeVisible();
        await expectClean(page, `${label}, add wizard, groups`);

        await open(page, "/admin/links/grafana", theme, mode, width);
        await expect(page.getByRole("heading", { level: 1, name: "Grafana" })).toBeVisible();
        await expectClean(page, `${label}, link page`);
        await page.getByLabel("Title", { exact: true }).fill("");
        await page.getByRole("button", { name: "Save" }).click();
        await expect(page.getByRole("group", { name: "Check the highlighted fields." })).toBeFocused();
        await expectClean(page, `${label}, link page with errors`);
        await page.getByRole("button", { name: "Delete Grafana" }).click();
        await expect(page.getByRole("group", { name: "Delete the link Grafana?" })).toBeFocused();
        await expectClean(page, `${label}, delete confirmation`);

        await open(page, "/admin/links/categories/dev-tools", theme, mode, width);
        await expect(page.getByRole("heading", { level: 1, name: "Developer tools" })).toBeVisible();
        await expect(page.getByRole("checkbox", { name: "Developers typed, never received" })).toBeChecked();
        await expectClean(page, `${label}, category page`);

        await page.route("**/api/admin/catalog/state", (route) =>
          route.fulfill({ json: { managedByFile: true, categories: 2, links: 3, groups: 3, checks: { intervalMinutes: 5, staleAfterMinutes: 15, checked: 0, capacity: null } }, headers: { "cache-control": "no-store" } }),
        );
        await open(page, "/admin/links", theme, mode, width);
        await expect(page.getByText("Managed by CATALOG_FILE: read only.")).toBeVisible();
        await expectClean(page, `${label}, read-only`);
        await open(page, "/admin/links/mail", theme, mode, width);
        await expect(page.getByLabel("Title", { exact: true })).toBeDisabled();
        await expectClean(page, `${label}, read-only link page`);
        await page.unroute("**/api/admin/catalog/state");
        expect(csp).toEqual([]);
      }
    }
  }
});

test("the link checks are accessible in every theme, mode and width", async ({ page }) => {
  test.setTimeout(300_000);
  await signInAsAdmin(page);
  await importStatusLinks(page.request);
  for (const theme of THEMES) {
    for (const mode of MODES) {
      for (const width of WIDTHS) {
        const label = `link checks (${theme}, ${mode}, ${width}px)`;
        const csp = watchCsp(page);
        await open(page, "/admin/links", theme, mode, width);
        await expect(page.getByRole("table", { name: "Links of Status checks" })).toBeVisible();
        await expect(rowOf(page, "Status down")).toContainText("Down");
        await expect(rowOf(page, "Status old")).toContainText("Status unknown");
        await expect(rowOf(page, "Status new")).toContainText("Status unknown");
        await expect(rowOf(page, "Status up")).not.toContainText(/Down|Status unknown/);
        await expectClean(page, label);

        await open(page, "/admin/links?state=down", theme, mode, width);
        await expect(page.getByText("Filter: Down")).toBeVisible();
        await expect(page.getByRole("table", { name: "Links of Status checks" }).getByRole("link")).toHaveText(["Status down"]);
        await expectClean(page, `${label}, narrowed to down`);
        await open(page, "/admin/links?state=statusUnknown", theme, mode, width);
        await expect(page.getByText("Filter: Status unknown")).toBeVisible();
        await expect(page.getByRole("table", { name: "Links of Status checks" }).getByRole("link")).toHaveText(["Status old", "Status new"]);
        await expectClean(page, `${label}, narrowed to status unknown`);

        await open(page, "/admin/links/status-down", theme, mode, width);
        const block = page.getByRole("region", { name: "Last check" });
        await expect(block).toContainText("Down");
        await expect(block).toContainText("HTTP error, HTTP 502");
        await expect(page.getByRole("checkbox", { name: "Check availability" })).toBeChecked();
        await expectClean(page, `${label}, down link page`);
        await open(page, "/admin/links/status-new", theme, mode, width);
        await expect(page.getByRole("region", { name: "Last check" })).toContainText("Not checked yet");
        await expectClean(page, `${label}, never checked link page`);

        // Docker has no static capacity, so the overload warning only shows from a mocked Workers state.
        await page.route("**/api/admin/catalog/state", async (route) => {
          const real = await (await route.fetch()).json();
          await route.fulfill({ json: { ...real, checks: { ...real.checks, checked: 51, capacity: 50 } }, headers: { "cache-control": "no-store" } });
        });
        await open(page, "/admin/links", theme, mode, width);
        await expect(page.getByRole("note")).toContainText("51 links are checked, but this instance can check 50 per interval.");
        await expectClean(page, `${label}, overloaded`);
        await page.unroute("**/api/admin/catalog/state");
        expect(csp).toEqual([]);
      }
    }
  }
});

test("the history page is accessible, an entry open, in every theme, mode and width", async ({ page }) => {
  test.setTimeout(300_000);
  await signInAsAdmin(page);
  await importCatalog(page.request, CATALOG);
  const joined = await page.request.put(`/api/admin/groups/adm-reviewers/members/${MARGARET.id}`, { data: {} });
  expect(joined.ok(), await joined.text()).toBe(true);
  for (const theme of THEMES) {
    for (const mode of MODES) {
      for (const width of WIDTHS) {
        const label = `history (${theme}, ${mode}, ${width}px)`;
        const csp = watchCsp(page);
        await open(page, "/admin/history", theme, mode, width);
        await expect(page.getByRole("heading", { level: 1, name: "History" })).toBeVisible();
        const member = page.getByRole("button", { name: "Details: Member added, Reviewers" }).first();
        await expect(member).toBeVisible();
        await expectClean(page, label);
        await member.click();
        await expect(member).toHaveAttribute("aria-expanded", "true");
        const imported = page.getByRole("button", { name: "Details: Import, Catalog" }).first();
        await imported.click();
        await expect(imported).toHaveAttribute("aria-expanded", "true");
        await expectClean(page, `${label}, entries open`);

        await open(page, "/admin/groups/adm-reviewers", theme, mode, width);
        await expect(page.getByRole("region", { name: "Latest changes" })).toBeVisible();
        await expectClean(page, `${label}, latest changes of a group`);
        expect(csp).toEqual([]);
      }
    }
  }
});

test("the YAML file page is accessible in each of its states, in every theme, mode and width", async ({ page }) => {
  test.setTimeout(300_000);
  await signInAsAdmin(page);
  for (const theme of THEMES) {
    for (const mode of MODES) {
      for (const width of WIDTHS) {
        const label = `catalog (${theme}, ${mode}, ${width}px)`;
        const csp = watchCsp(page);
        await importCatalog(page.request, CATALOG);
        await open(page, "/admin/links/file", theme, mode, width);
        await expect(page.getByText("2 categories, 3 links, 3 groups in use.")).toBeVisible();
        await expectClean(page, label);

        // A slow preview shows the waiting file control.
        await page.route("**/api/admin/catalog", async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 800));
          await route.continue();
        });
        await page.getByLabel("Choose a file").setInputFiles("e2e/fixtures/catalog-next.yaml");
        await expect(page.getByText("Checking…")).toBeVisible();
        await expectClean(page, `${label}, checking`);
        const preview = page.getByRole("heading", { level: 2, name: "Import preview" });
        await expect(preview).toBeFocused();
        await page.unroute("**/api/admin/catalog");
        await expect(page.getByRole("button", { name: "Import and delete 1 item" })).toBeVisible();
        await expectClean(page, `${label}, preview`);

        await page.getByRole("button", { name: "Import and delete 1 item" }).click();
        await expect(page.getByRole("heading", { level: 2, name: "Catalog imported" })).toBeFocused();
        await expectClean(page, `${label}, result`);
        await page.getByRole("button", { name: "Import another file" }).click();
        await expect(page.getByLabel("Choose a file")).toBeFocused();

        await page.getByLabel("Choose a file").setInputFiles({ name: "broken.yaml", mimeType: "application/yaml", buffer: Buffer.from("version: 2\ncategories: oops\n") });
        await expect(page.getByRole("group", { name: /This file is not a valid catalog/ })).toBeFocused();
        await expectClean(page, `${label}, invalid file`);

        // A preview only: the private address is never imported, so never checked.
        await page.getByLabel("Choose a file").setInputFiles({ name: "lab.yaml", mimeType: "application/yaml", buffer: Buffer.from(CHECKED_LAB) });
        await expect(page.getByRole("heading", { level: 2, name: "Import preview" })).toBeFocused();
        await expect(page.getByText("NAS: Availability check: private or local address, never contacted.")).toBeVisible();
        await expectClean(page, `${label}, preview with a check warning`);
        await page.getByRole("button", { name: "Cancel" }).click();
        await expect(page.getByLabel("Choose a file")).toBeFocused();

        await page.route("**/api/admin/catalog/state", (route) =>
          route.fulfill({ json: { managedByFile: true, categories: 4, links: 4, groups: 5, checks: { intervalMinutes: 5, staleAfterMinutes: 15, checked: 0, capacity: null } }, headers: { "cache-control": "no-store" } }),
        );
        await page.reload();
        await expect(page.getByText("The catalog comes from a file")).toBeVisible();
        await expectClean(page, `${label}, read-only`);
        await page.unroute("**/api/admin/catalog/state");
        expect(csp).toEqual([]);
      }
    }
  }
});

test("the administration pages fit a 320 px screen in French", async ({ page }) => {
  await signInAsAdmin(page);
  await open(page, "/admin/users", "default", "light", 320);
  await page.evaluate(() => localStorage.setItem("yasad.language", "fr"));
  for (const [path, title] of [
    ["/admin", "Tableau de bord"],
    ["/admin/users", "Personnes"],
    ["/admin/users/new", "Ajouter"],
    [`/admin/users/${GRACE.id}`, GRACE.name],
    ["/admin/groups/adm-staff", "Staff"],
    ["/admin/links", "Liens"],
    ["/admin/links/new", "Ajouter"],
    ["/admin/links/mail", "Mail"],
    ["/admin/links/file", "Fichier YAML"],
    ["/admin/history", "Historique"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expectNoHorizontalScroll(page, `${path} in French`);
  }
  await page.goto("/admin/users/new");
  await page.getByRole("button", { name: "Suivant" }).click();
  await page.getByRole("button", { name: "Suivant" }).click();
  await expect(page.getByRole("group", { name: "Vérifiez les champs signalés." })).toBeFocused();
  await expectNoHorizontalScroll(page, "add wizard with errors in French");

  await importStatusLinks(page.request);
  for (const [path, title] of [
    ["/admin/links?state=down", "Liens"],
    ["/admin/links/status-down", "Status down"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByText("En panne").first()).toBeVisible();
    await expectNoHorizontalScroll(page, `${path} in French`);
  }
  // The tests after this one open the example's links.
  await importCatalog(page.request, CATALOG);
});

test("on a wide screen, the header lines up with the content, lists use the wide column and item and account pages keep their former width", async ({ page }) => {
  await signInAsAdmin(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  const box = async (selector: string) => (await page.locator(selector).first().boundingBox())!;

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const header = await box("header");
  const main = await box("main#content");
  expect(Math.abs(header.x - main.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(header.width - main.width)).toBeLessThanOrEqual(1);
  expect(main.width).toBeCloseTo(1280, 0);

  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  expect((await box("table")).width).toBeGreaterThan(1024);

  await page.goto(`/admin/users/${GRACE.id}`);
  await expect(page.getByRole("heading", { level: 1, name: GRACE.name })).toBeVisible();
  expect((await box("main#content .max-w-5xl")).width).toBeLessThanOrEqual(1024);

  await page.goto("/admin/links/mail");
  await expect(page.getByRole("heading", { level: 1, name: "Mail" })).toBeVisible();
  expect((await box("main#content .max-w-5xl")).width).toBeLessThanOrEqual(1024);

  await page.goto("/account");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect((await box('[data-slot="page"]')).width).toBeLessThanOrEqual(1024);
});

test.describe("keyboard and focus", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("opens a person from the table and comes back to the same row, the filter kept", async ({ page }) => {
    await page.goto("/admin/users");
    await page.getByLabel("Filter by name or e-mail").fill("marg");
    await page.getByRole("link", { name: MARGARET.name }).click();
    await expect(page.getByRole("heading", { level: 1, name: MARGARET.name })).toBeFocused();
    await page.getByRole("link", { name: "Back to People" }).click();
    await expect(page).toHaveURL(/\/admin\/users\?q=marg$/);
    await expect(page.getByRole("link", { name: MARGARET.name })).toBeFocused();
  });

  test("edits a person on their page and announces it, the focus staying on Save", async ({ page }) => {
    await page.goto(`/admin/users/${MARGARET.id}`);
    await page.getByLabel("Name", { exact: true }).fill("Margaret H. Hamilton");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Margaret H. Hamilton" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toBeFocused();
    await expect(announcer(page)).toHaveText("Margaret H. Hamilton updated.");
  });

  test("deletes a person, back on the table with a focused message from which Tab goes on to the next row", async ({ page }) => {
    await page.goto("/admin/users");
    await page.getByRole("link", { name: TEMP.name }).click();
    const remove = page.getByRole("button", { name: `Delete ${TEMP.name}` });
    await remove.click();
    await page.keyboard.press("Escape");
    await expect(remove).toBeFocused();
    await remove.click();
    await page.getByRole("button", { name: "Delete for good" }).click();
    const tombstone = page.getByRole("group", { name: `${TEMP.name} deleted.` });
    await expect(tombstone).toBeFocused();
    await expect(page).toHaveURL(/\/admin\/users$/);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Ada Lovelace" })).toBeFocused();
  });

  test("removes and adds a member with the check boxes of the group page, each change announced", async ({ page }) => {
    await page.goto("/admin/groups/adm-staff");
    const ken = page.getByRole("checkbox", { name: KEN.name });
    await expect(ken).toBeChecked();
    await ken.uncheck();
    await expect(announcer(page)).toHaveText(`${KEN.name} removed from Staff.`);
    await expect(ken).toBeFocused();
    await ken.check();
    await expect(announcer(page)).toHaveText(`${KEN.name} added to Staff.`);
    await expect(ken).toBeChecked();
  });

  test("adds a person with the wizard and shows the temporary password once", async ({ page }) => {
    await page.goto("/admin/users");
    await page.getByRole("link", { name: "Add", exact: true }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Identity" })).toBeFocused();
    await page.getByLabel("Name", { exact: true }).fill("Radia Perlman");
    await page.getByLabel("E-mail", { exact: true }).fill("radia@example.invalid");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("checkbox", { name: "Reviewers" }).check();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Summary" })).toBeFocused();
    await page.getByRole("button", { name: "Create the account" }).click();
    const secret = page.getByRole("region", { name: "Temporary password for Radia Perlman" });
    await expect(secret).toBeFocused();
    await secret.getByRole("button", { name: "I have noted it" }).click();
    await expect(page.getByRole("link", { name: "Radia Perlman" })).toBeFocused();
    await expect(page.getByRole("link", { name: "Radia Perlman" }).locator("xpath=ancestor::tr")).toContainText("Reviewers");
  });

  test("exports the catalog as a YAML file", async ({ page }) => {
    await importCatalog(page.request, CATALOG);
    await page.goto("/admin/links/file");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export the catalog (YAML)" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("catalog.yaml");
    const text = readFileSync(await file.path(), "utf8");
    expect(text).toContain("version: 1");
    expect(text).toContain("id: dev-tools");
  });

  test("previews again when the catalog changes between the preview and the import", async ({ page }) => {
    await importCatalog(page.request, CATALOG);
    await page.goto("/admin/links/file");
    await page.getByLabel("Choose a file").setInputFiles("e2e/fixtures/catalog-next.yaml");
    await expect(page.getByRole("heading", { level: 2, name: "Import preview" })).toBeFocused();
    await importCatalog(page.request, CATALOG.replace("title: Mail", "title: Webmail"));
    await page.getByRole("button", { name: "Import and delete 1 item" }).click();
    const warning = page.getByRole("group", { name: /The catalog changed since the previous preview/ });
    await expect(warning).toBeFocused();
    // The file now renames Webmail back to Mail: the new preview lists that change.
    await expect(page.getByRole("region", { name: "Import preview" })).toContainText("Mail mail");
  });

  test("the former catalog address opens the YAML file page", async ({ page }) => {
    await page.goto("/admin/catalog");
    await expect(page.getByRole("heading", { level: 1, name: "YAML file" })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/links\/file$/);
  });

  test("creates a category and a link, moves and deactivates the link with the keyboard, and the home page follows", async ({ page }) => {
    await importCatalog(page.request, CATALOG);
    await page.goto("/admin/links/categories/new");
    await expect(page.getByRole("heading", { level: 1, name: "Add" })).toBeVisible();
    const next = page.getByRole("button", { name: "Next" });
    await next.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("textbox", { name: "Title" }).fill("Keyboard shelf");
    await next.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("checkbox", { name: "@authenticated" }).focus();
    await page.keyboard.press("Space");
    await next.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Create" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("link", { name: "Keyboard shelf" })).toBeFocused();

    for (const [title, url] of [["First door", "https://first.example.org"], ["Second door", "https://second.example.org"]] as const) {
      await page.goto("/admin/links/new");
      await next.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("textbox", { name: "Address" }).fill(url);
      await page.getByRole("textbox", { name: "Title" }).fill(title);
      await next.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("combobox", { name: "Category" }).selectOption({ label: "Keyboard shelf" });
      await next.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("checkbox", { name: "@authenticated" }).focus();
      await page.keyboard.press("Space");
      await next.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Skip" }).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Create" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("link", { name: title })).toBeFocused();
    }

    await page.getByRole("button", { name: "Reorder" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Links", exact: true }).focus();
    await page.keyboard.press("Enter");
    const up = page.getByRole("button", { name: "Move up the link Second door" });
    await up.focus();
    await page.keyboard.press("Enter");
    await expect(announcer(page)).toHaveText("Second door: position 1 of 2 in Keyboard shelf");
    await expect(up).toBeFocused();
    await expect(up).toHaveAttribute("aria-disabled", "true");
    await page.getByRole("button", { name: "Done" }).focus();
    await page.keyboard.press("Enter");

    await page.goto("/");
    const shelf = page.getByRole("region", { name: "Keyboard shelf" });
    await expect(shelf.getByRole("link")).toHaveText([/Second door/, /First door/]);

    await page.goto("/admin/links/first-door");
    await page.getByRole("checkbox", { name: "Active" }).focus();
    await page.keyboard.press("Space");
    await page.getByRole("button", { name: "Save" }).focus();
    await page.keyboard.press("Enter");
    await expect(announcer(page)).toHaveText("Saved: First door.");
    await page.goto("/");
    await expect(shelf.getByRole("link")).toHaveText([/Second door/]);
  });

  test("opens a down link from the list narrowed on down links, reads its last check and comes back to its row", async ({ page }) => {
    await importStatusLinks(page.request);
    await page.goto("/admin/links?state=down");
    const row = page.getByRole("link", { name: "Status down", exact: true });
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Status down" })).toBeFocused();
    await expect(page.getByRole("region", { name: "Last check" })).toContainText("HTTP error, HTTP 502");
    await page.getByRole("link", { name: "Back to Links" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/admin\/links\?state=down$/);
    await expect(row).toBeFocused();
  });

  test("checks a new link from the wizard with the keyboard, then stops checking it on its page", async ({ page }) => {
    // A *.home.arpa name: the outbound policy refuses it before any lookup, so the scheduler contacts nothing.
    await importCatalog(page.request, CATALOG);
    await page.goto("/admin/links/new");
    const next = page.getByRole("button", { name: "Next" });
    await next.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("textbox", { name: "Address" }).fill("http://nas.home.arpa");
    await page.getByRole("textbox", { name: "Title" }).fill("Home NAS");
    await next.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("combobox", { name: "Category" }).selectOption({ label: "Everyday" });
    await next.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("checkbox", { name: "@authenticated" }).focus();
    await page.keyboard.press("Space");
    await next.focus();
    await page.keyboard.press("Enter");
    const check = page.getByRole("checkbox", { name: "Check availability" });
    await check.focus();
    await page.keyboard.press("Space");
    await expect(check).toBeChecked();
    await next.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 2, name: "Summary" })).toBeFocused();
    await expect(page.locator("dt", { hasText: "Check availability" }).locator("xpath=following-sibling::dd[1]")).toHaveText("Yes");
    await page.getByRole("button", { name: "Create" }).focus();
    await page.keyboard.press("Enter");
    await expect(announcer(page)).toHaveText("Created: Home NAS. Availability check: private or local address, never contacted.");
    const row = page.getByRole("link", { name: "Home NAS", exact: true });
    await expect(row).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Home NAS" })).toBeFocused();
    await expect(check).toBeChecked();
    await check.focus();
    await page.keyboard.press("Space");
    await page.getByRole("button", { name: "Save" }).focus();
    await page.keyboard.press("Enter");
    await expect(announcer(page)).toHaveText("Saved: Home NAS.");
    await page.reload();
    await expect(page.getByRole("checkbox", { name: "Check availability" })).not.toBeChecked();
  });

  test("lists every account as a check box on a group page, narrowed by its filter, with 300 accounts", async ({ page }) => {
    addUsers(300, "Person");
    await page.goto("/admin/groups/adm-reviewers");
    await expect(page.getByRole("checkbox", { name: /^Person \d+$/ })).toHaveCount(300);
    await page.getByLabel("Filter", { exact: true }).fill("person 299");
    await expect(page.getByRole("checkbox")).toHaveCount(1);
    await expect(page.getByRole("checkbox", { name: "Person 299" })).not.toBeChecked();
  });
});
