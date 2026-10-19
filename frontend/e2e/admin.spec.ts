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

const CATALOG = readFileSync("../docs/catalog.example.yaml", "utf8");

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
  addOidcUser(KEN);
  addGroup({ id: "adm-staff", name: "Staff", memberIds: [GRACE.id, KEN.id, LINUS.id] });
  addGroup({ id: "adm-reviewers", name: "Reviewers" });
  addGroup({ id: "adm-engineering", name: "Engineering", source: "oidc", memberIds: [KEN.id] });
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

test("the catalog page is accessible in each of its states, in every theme, mode and width", async ({ page }) => {
  test.setTimeout(300_000);
  await signInAsAdmin(page);
  for (const theme of THEMES) {
    for (const mode of MODES) {
      for (const width of WIDTHS) {
        const label = `catalog (${theme}, ${mode}, ${width}px)`;
        const csp = watchCsp(page);
        await importCatalog(page.request, CATALOG);
        await open(page, "/admin/catalog", theme, mode, width);
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

        await page.route("**/api/admin/catalog/state", (route) =>
          route.fulfill({ json: { managedByFile: true, categories: 4, links: 4, groups: 5 }, headers: { "cache-control": "no-store" } }),
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
    ["/admin/users", "Personnes"],
    ["/admin/users/new", "Ajouter"],
    [`/admin/users/${GRACE.id}`, GRACE.name],
    ["/admin/groups/adm-staff", "Staff"],
    ["/admin/catalog", "Catalogue"],
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
    await page.goto("/admin/catalog");
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
    await page.goto("/admin/catalog");
    await page.getByLabel("Choose a file").setInputFiles("e2e/fixtures/catalog-next.yaml");
    await expect(page.getByRole("heading", { level: 2, name: "Import preview" })).toBeFocused();
    await importCatalog(page.request, CATALOG.replace("title: Mail", "title: Webmail"));
    await page.getByRole("button", { name: "Import and delete 1 item" }).click();
    const warning = page.getByRole("group", { name: /The catalog changed since the previous preview/ });
    await expect(warning).toBeFocused();
    // The file now renames Webmail back to Mail: the new preview lists that change.
    await expect(page.getByRole("region", { name: "Import preview" })).toContainText("Mail mail");
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
