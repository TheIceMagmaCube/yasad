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

test("the users page is accessible in each of its states, in every theme, mode and width", async ({ page }) => {
  test.setTimeout(300_000);
  await signInAsAdmin(page);
  for (const theme of THEMES) {
    for (const mode of MODES) {
      for (const width of WIDTHS) {
        const label = `users (${theme}, ${mode}, ${width}px)`;
        const csp = watchCsp(page);
        await open(page, "/admin/users", theme, mode, width);
        await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
        await expect(page.getByText(GRACE.name, { exact: true })).toBeVisible();
        await expectClean(page, label);

        await page.getByRole("button", { name: "New user" }).click();
        await expect(page.getByLabel("Name", { exact: true })).toBeFocused();
        await expectClean(page, `${label}, new user form`);
        await page.getByRole("button", { name: "Create the account" }).click();
        await expect(page.getByRole("group", { name: "Check the highlighted fields." })).toBeFocused();
        await expectClean(page, `${label}, new user form with errors`);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("button", { name: "New user" })).toBeFocused();

        await page.getByRole("button", { name: `Reset password for ${LINUS.name}` }).click();
        await expect(page.getByRole("group", { name: `Reset the password of ${LINUS.name}?` })).toBeFocused();
        await expectClean(page, `${label}, reset confirmation`);
        await page.getByRole("button", { name: "Reset", exact: true }).click();
        const secret = page.getByRole("region", { name: `Temporary password for ${LINUS.name}` });
        await expect(secret).toBeFocused();
        await expectClean(page, `${label}, temporary password`);
        await secret.getByRole("button", { name: "I have noted it" }).click();
        await expect(page.getByRole("button", { name: `Reset password for ${LINUS.name}` })).toBeFocused();

        await page.getByRole("button", { name: `Delete ${GRACE.name}` }).click();
        await expect(page.getByRole("group", { name: `Delete ${GRACE.name}?` })).toBeFocused();
        await expectClean(page, `${label}, delete confirmation`);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("button", { name: `Delete ${GRACE.name}` })).toBeFocused();
        expect(csp).toEqual([]);
      }
    }
  }
});

test("the groups page is accessible in each of its states, in every theme, mode and width", async ({ page }) => {
  test.setTimeout(300_000);
  await signInAsAdmin(page);
  for (const theme of THEMES) {
    for (const mode of MODES) {
      for (const width of WIDTHS) {
        const label = `groups (${theme}, ${mode}, ${width}px)`;
        const csp = watchCsp(page);
        await open(page, "/admin/groups", theme, mode, width);
        await expect(page.getByRole("heading", { level: 2, name: "Built-in" })).toBeVisible();
        await expect(page.getByRole("heading", { level: 2, name: "Local" })).toBeVisible();
        await expect(page.getByRole("heading", { level: 2, name: "Identity provider" })).toBeVisible();
        await expectClean(page, label);

        await page.getByRole("button", { name: "Members (3) of Staff" }).click();
        await expect(page.getByLabel("Add people")).toBeFocused();
        await expect(page.getByRole("list", { name: "Members of Staff" }).getByRole("listitem")).toHaveCount(3);
        await expect(page.getByRole("button", { name: /^Add .* to Staff$/ }).first()).toBeVisible();
        await expectClean(page, `${label}, members`);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("button", { name: "Members (3) of Staff" })).toBeFocused();

        await page.getByRole("button", { name: "Rename Staff" }).click();
        await expect(page.getByLabel("Name", { exact: true })).toBeFocused();
        await page.keyboard.type("reviewers");
        await page.keyboard.press("Enter");
        await expect(page.getByRole("group", { name: "Check the highlighted fields." })).toBeFocused();
        await expectClean(page, `${label}, rename with errors`);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("button", { name: "Rename Staff" })).toBeFocused();
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
    ["/admin/users", "Utilisateurs"],
    ["/admin/groups", "Groupes"],
    ["/admin/catalog", "Catalogue"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expectNoHorizontalScroll(page, `${path} in French`);
  }
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Nouvel utilisateur" }).click();
  await page.getByRole("button", { name: "Créer le compte" }).click();
  await expect(page.getByRole("group", { name: "Vérifiez les champs signalés." })).toBeFocused();
  await expectNoHorizontalScroll(page, "new user form with errors in French");
  await page.goto("/admin/groups");
  await page.getByRole("button", { name: "Membres (3) de Staff" }).click();
  await expect(page.getByLabel("Ajouter des personnes")).toBeFocused();
  await expectNoHorizontalScroll(page, "members of Staff in French");
});

test.describe("keyboard and focus", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("edits a user in the row and comes back to Edit, with the status line and an announcement", async ({ page }) => {
    await page.goto("/admin/users");
    const edit = page.getByRole("button", { name: `Edit ${MARGARET.name}` });
    await edit.click();
    await expect(edit).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel("Name", { exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(edit).toBeFocused();

    await edit.click();
    await page.getByLabel("Name", { exact: true }).fill("Margaret H. Hamilton");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Edit Margaret H. Hamilton" })).toBeFocused();
    await expect(page.locator('[data-slot="toolbar-status"]')).toHaveText("Margaret H. Hamilton updated.");
    await expect(announcer(page)).toHaveText("Margaret H. Hamilton updated.");
  });

  test("deletes a user, leaving a focused message from which Tab goes on to the next row", async ({ page }) => {
    await page.goto("/admin/users");
    const remove = page.getByRole("button", { name: `Delete ${TEMP.name}` });
    await remove.click();
    await page.keyboard.press("Escape");
    await expect(remove).toBeFocused();
    await remove.click();
    await page.getByRole("button", { name: "Delete for good" }).click();
    const tombstone = page.getByRole("group", { name: `${TEMP.name} deleted.` });
    await expect(tombstone).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Edit Ada Lovelace" })).toBeFocused();
  });

  test("removes a member in one click and adds one back, the focus staying in the members panel", async ({ page }) => {
    await page.goto("/admin/groups");
    await page.getByRole("button", { name: "Members (3) of Staff" }).click();
    const picker = page.getByLabel("Add people");
    await expect(picker).toBeFocused();
    await page.getByRole("button", { name: `Remove ${KEN.name} from Staff` }).click();
    await expect(page.getByRole("button", { name: `Remove ${LINUS.name} from Staff` })).toBeFocused();
    await expect(announcer(page)).toHaveText(`${KEN.name} removed from Staff.`);

    await picker.fill("ken");
    await page.getByRole("button", { name: `Add ${KEN.name} to Staff` }).click();
    await expect(picker).toBeFocused();
    await expect(picker).toHaveValue("ken");
    await expect(page.getByRole("list", { name: "Members of Staff" })).toContainText(KEN.name);
    await expect(announcer(page)).toHaveText(`${KEN.name} added to Staff.`);
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

  test("lists eight people at most in the member picker, with 300 accounts", async ({ page }) => {
    addUsers(300, "Person");
    await page.goto("/admin/groups");
    await page.getByRole("button", { name: "Members (0) of Reviewers" }).click();
    // Every account but its members is offered, the 300 and the others: eight are listed.
    await expect(page.getByRole("button", { name: /^Add .+ to Reviewers$/ })).toHaveCount(8);
    await expect(page.getByText(/^\d+ people match, 8 shown\. Narrow the search\.$/)).toBeVisible();
    await page.getByLabel("Add people").fill("person 29");
    await expect(page.getByText("13 people match, 8 shown. Narrow the search.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Add Person \d+ to Reviewers$/ })).toHaveCount(8);
    await page.getByLabel("Add people").fill("person 299");
    await expect(page.getByRole("button", { name: /^Add .+ to Reviewers$/ })).toHaveCount(1);
  });
});
