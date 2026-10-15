import { expect, type Page, test } from "@playwright/test";

import { SETUP_CODE } from "../playwright.config";
import { addTemporaryUser, ADMIN, expectAccessible, MODES, setInstanceTheme, TEMPORARY, THEMES, watchCsp, WIDTHS } from "./helpers";

test.describe.configure({ mode: "serial" });

/** Open the page with the given system colour scheme and width, after setting the instance theme. */
async function open(page: Page, path: string, theme: string, mode: string, width: number): Promise<void> {
  setInstanceTheme(theme);
  await page.emulateMedia({ colorScheme: mode as "light" | "dark" });
  await page.setViewportSize({ width, height: 800 });
  await page.goto(path);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
}

async function signIn(page: Page): Promise<void> {
  const res = await page.request.post("/api/auth/sign-in/email", { data: { email: ADMIN.email, password: ADMIN.password } });
  expect(res.ok()).toBe(true);
}

for (const theme of THEMES) {
  for (const mode of MODES) {
    for (const width of WIDTHS) {
      test(`setup screen is accessible (${theme}, ${mode}, ${width}px)`, async ({ page }) => {
        const csp = watchCsp(page);
        await open(page, "/", theme, mode, width);
        await expect(page.getByRole("heading", { name: "Set up YASAD" })).toBeVisible();
        await expectAccessible(page, "setup, code step");
        await page.getByLabel("Setup code").fill(SETUP_CODE);
        await page.getByRole("button", { name: "Continue" }).click();
        await expect(page.getByLabel("Confirm password")).toBeVisible();
        await expectAccessible(page, "setup, admin step");
        expect(csp).toEqual([]);
      });
    }
  }
}

test("setup creates the administrator", async ({ page }) => {
  setInstanceTheme("default");
  await page.goto("/");
  await page.getByLabel("Setup code").fill(SETUP_CODE);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Name").fill(ADMIN.name);
  await page.getByLabel("E-mail").fill(ADMIN.email);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
  await page.getByLabel("Confirm password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Create administrator" }).click();
  await expect(page.getByRole("heading", { name: "YASAD is ready" })).toBeVisible();
});

for (const theme of THEMES) {
  for (const mode of MODES) {
    for (const width of WIDTHS) {
      test(`sign-in and home are accessible (${theme}, ${mode}, ${width}px)`, async ({ page }) => {
        const csp = watchCsp(page);
        await open(page, "/", theme, mode, width);
        await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
        await expectAccessible(page, "sign-in");

        await signIn(page);
        await page.reload();
        await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
        await expectAccessible(page, "home");
        await page.getByRole("button", { name: `Account menu for ${ADMIN.name}` }).click();
        await expect(page.getByRole("menu")).toBeVisible();
        await expectAccessible(page, "home, account menu open");
        expect(csp).toEqual([]);
      });
    }
  }
}

test("the catalog page previews and imports a file, accessibly", async ({ page }) => {
  await signIn(page);
  for (const theme of THEMES) {
    for (const mode of MODES) {
      const csp = watchCsp(page);
      await open(page, "/admin/catalog", theme, mode, 320);
      await expect(page.getByRole("heading", { name: "Catalog", exact: true })).toBeVisible();
      await page.getByLabel("Catalog file").setInputFiles("../docs/catalog.example.yaml");
      await expect(page.getByRole("button", { name: "Import" })).toBeVisible();
      await expectAccessible(page, `catalog preview (${theme}, ${mode})`);
      expect(csp).toEqual([]);
    }
  }
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByRole("status")).toHaveText("Catalog imported.");
});

test("the users and groups pages create an account and a group, accessibly", async ({ page }) => {
  await signIn(page);
  const csp = watchCsp(page);
  await open(page, "/admin/users", "default", "light", 320);
  await page.getByRole("button", { name: "New user" }).click();
  await page.getByLabel("Name").fill("Grace Hopper");
  await page.getByLabel("E-mail").fill("grace@example.invalid");
  await page.getByRole("button", { name: "Create the account" }).click();
  await expect(page.getByRole("region", { name: "Temporary password for Grace Hopper" })).toBeFocused();
  await expectAccessible(page, "temporary password panel");

  await open(page, "/admin/groups", "default", "light", 320);
  await page.getByRole("button", { name: "New group" }).click();
  await page.getByLabel("Name").fill("Reviewers");
  await page.getByRole("button", { name: "Create the group" }).click();
  await page.getByLabel("Person to add to Reviewers").selectOption({ label: "Grace Hopper (grace@example.invalid)" });
  await page.getByRole("button", { name: "Add a member to Reviewers" }).click();
  await expect(page.getByRole("button", { name: "Remove Grace Hopper" })).toBeVisible();

  for (const theme of THEMES) {
    for (const mode of MODES) {
      for (const path of ["/admin/users", "/admin/groups"]) {
        await open(page, path, theme, mode, 320);
        await expect(page.getByRole("link", { name: path.endsWith("users") ? "Users" : "Groups" })).toHaveAttribute("aria-current", "page");
        await expect(page.getByRole("heading", { name: /^Grace Hopper|^Reviewers/ })).toBeVisible();
        await expectAccessible(page, `${path} (${theme}, ${mode})`);
      }
    }
  }
  expect(csp).toEqual([]);
});

test("the temporary password screen is accessible", async ({ page }) => {
  await addTemporaryUser();
  const res = await page.request.post("/api/auth/sign-in/email", { data: TEMPORARY });
  expect(res.ok()).toBe(true);
  for (const theme of THEMES) {
    for (const mode of MODES) {
      const csp = watchCsp(page);
      await open(page, "/", theme, mode, 320);
      await expect(page.getByRole("heading", { name: "Choose your password" })).toBeVisible();
      await expectAccessible(page, `change password (${theme}, ${mode})`);
      expect(csp).toEqual([]);
    }
  }
});

test("the account menu works with the keyboard", async ({ page }) => {
  setInstanceTheme("default");
  await signIn(page);
  await page.goto("/");
  const trigger = page.getByRole("button", { name: `Account menu for ${ADMIN.name}` });
  await expect(trigger).toBeVisible();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("banner").getByRole("link", { name: "YASAD" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: "English" })).toBeFocused();

  for (const name of ["Français", "System", "Light", "Dark"]) {
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitemradio", { name })).toBeFocused();
  }
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("the language follows the person's choice", async ({ page }) => {
  setInstanceTheme("default");
  await page.goto("/");
  await page.getByLabel("Language").selectOption("fr");
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
});
