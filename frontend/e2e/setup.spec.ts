import { expect, test } from "@playwright/test";

import { SETUP_CODE } from "../playwright.config";
import { ADMIN, expectAccessible, expectNoHorizontalScroll, focused, MODES, open, setInstanceTheme, THEMES, watchCsp, WIDTHS } from "./helpers";

test.describe.configure({ mode: "serial" });

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
        await expectNoHorizontalScroll(page, "setup, admin step");
        expect(csp).toEqual([]);
      });
    }
  }
}

test("a wrong setup code stays on its field and is selected from the summary link", async ({ page }) => {
  const csp = watchCsp(page);
  await open(page, "/", "default", "light", 1280);
  const code = page.getByLabel("Setup code");
  await code.fill("not-the-code");
  await code.press("Enter");
  const summary = page.getByRole("group", { name: "Check the highlighted fields." });
  await expect(summary).toBeFocused();
  await expect(code).toHaveAttribute("aria-invalid", "true");
  await expect(code).toHaveValue("not-the-code");
  await expectAccessible(page, "setup, wrong code");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(code).toBeFocused();
  expect(await code.evaluate((el: HTMLInputElement) => el.value.slice(el.selectionStart!, el.selectionEnd!))).toBe("not-the-code");
  expect(csp).toEqual([]);
});

test("setup creates the administrator and focuses the final screen", async ({ page }) => {
  setInstanceTheme("default");
  const csp = watchCsp(page);
  await page.goto("/");
  await page.getByLabel("Setup code").fill(SETUP_CODE);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Set up YASAD" })).toBeFocused();
  await page.getByLabel("Name").fill(ADMIN.name);
  await page.getByLabel("E-mail").fill(ADMIN.email);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
  await page.getByLabel("Confirm password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Create administrator" }).click();
  const ready = page.getByRole("heading", { name: "YASAD is ready" });
  await expect(ready).toBeFocused();
  await expect(page).toHaveTitle("YASAD is ready - YASAD");
  await expectAccessible(page, "setup done");
  await page.getByRole("button", { name: "Go to YASAD" }).click();
  await expect(page.getByRole("heading", { name: "My links", level: 1 })).toBeFocused();
  expect(await focused(page)).toContain("My links");
  expect(csp).toEqual([]);
});
