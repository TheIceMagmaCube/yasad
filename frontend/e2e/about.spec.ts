import { expect, type Page, test } from "@playwright/test";

import { addLocalUser, ADMIN, expectAccessible, expectNoHorizontalScroll, MODES, open, setInstanceTheme, signInAsAdmin, THEMES, watchCsp, WIDTHS } from "./helpers";

test.describe.configure({ mode: "serial" });

// A name no other spec filters on: the e2e database is shared by the projects.
const UNA = { id: "una", name: "Una Ward", email: "una@example.invalid", password: "una's first passphrase" };

/** Sign the page's browser context in through the API. */
async function signInAs(page: Page, email: string, password: string): Promise<void> {
  const res = await page.request.post("/api/auth/sign-in/email", { data: { email, password } });
  expect(res.ok(), await res.text()).toBe(true);
}

test.beforeAll(async () => {
  await addLocalUser(UNA);
});

test("the about page is accessible in every theme, mode and width, and names the Docker build", async ({ page }) => {
  test.setTimeout(180_000);
  await signInAsAdmin(page);
  for (const theme of THEMES) {
    for (const mode of MODES) {
      for (const width of WIDTHS) {
        const label = `about (${theme}, ${mode}, ${width}px)`;
        const csp = watchCsp(page);
        await open(page, "/about", theme, mode, width);
        await expect(page.getByRole("heading", { level: 1, name: "About" })).toBeVisible();
        // server.ts passes "docker"; the e2e server runs from source, so without a version number.
        await expect(page.getByRole("heading", { name: "This instance" })).toBeVisible();
        await expect(page.getByText("Docker", { exact: true })).toBeVisible();
        await expect(page.getByText("(build without a version number)")).toBeVisible();
        await expectAccessible(page, label);
        await expectNoHorizontalScroll(page, label);
        expect(csp).toEqual([]);
      }
    }
  }
});

test("a user sees the about page without the instance section", async ({ page }) => {
  setInstanceTheme("default");
  await signInAs(page, UNA.email, UNA.password);
  await page.goto("/about");
  await expect(page.getByRole("heading", { level: 1, name: "About" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Credits" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "This instance" })).toHaveCount(0);
});

test("the account menu opens the about page with the focus on its heading", async ({ page }) => {
  setInstanceTheme("default");
  await signInAsAdmin(page);
  await page.goto("/");
  const trigger = page.getByRole("button", { name: `Account menu for ${ADMIN.name}` });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "My links" })).toBeFocused();
  for (const name of ["My account", "Administration", "About"]) {
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name })).toBeFocused();
  }
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole("heading", { level: 1, name: "About" })).toBeFocused();
  await expect(page).toHaveTitle("About - YASAD");
  await trigger.click();
  await expect(page.getByRole("menuitem", { name: "About" })).toHaveAttribute("aria-current", "page");
});

test("the about page fits a 320 px screen in French", async ({ page }) => {
  setInstanceTheme("default");
  await signInAsAdmin(page);
  await open(page, "/", "default", "light", 320);
  await page.evaluate(() => localStorage.setItem("yasad.language", "fr"));
  await page.goto("/about");
  await expect(page.getByRole("heading", { level: 1, name: "À propos" })).toBeVisible();
  await expect(page).toHaveTitle("À propos - YASAD");
  await expectNoHorizontalScroll(page, "about, fr");
  await expectAccessible(page, "about, fr");
  await page.evaluate(() => localStorage.removeItem("yasad.language"));
});
