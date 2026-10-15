import { expect, type Page, test } from "@playwright/test";

import { SETUP_CODE } from "../playwright.config";
import { ADMIN, expectAccessible, MODES, setInstanceTheme, THEMES, watchCsp, WIDTHS } from "./helpers";

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

test("the account menu works with the keyboard", async ({ page }) => {
  setInstanceTheme("default");
  await signIn(page);
  await page.goto("/");
  const trigger = page.getByRole("button", { name: `Account menu for ${ADMIN.name}` });
  await expect(trigger).toBeVisible();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: "English" })).toBeFocused();

  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown"); // Français, System, Light, Dark
  await expect(menu.getByRole("menuitemradio", { name: "Dark" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");

  await trigger.press("Enter");
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
