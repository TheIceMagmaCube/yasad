import { expect, type Page, test } from "@playwright/test";

import { addLocalUser, ADMIN, expectAccessible, expectNoHorizontalScroll, focused, MODES, open, setInstanceTheme, signInAsAdmin, THEMES, watchCsp, WIDTHS } from "./helpers";

test.describe.configure({ mode: "serial" });

const CAROL = { id: "carol", name: "Carol Shaw", email: "carol@example.invalid", password: "carol's first passphrase" };
const TESS = { id: "tess", name: "Tess", email: "tess@example.invalid", password: "tess temporary password", mustChangePassword: true };

/** Sign the page's browser context in through the API. */
async function signInAs(page: Page, email: string, password: string): Promise<void> {
  const res = await page.request.post("/api/auth/sign-in/email", { data: { email, password } });
  expect(res.ok(), await res.text()).toBe(true);
}

test.beforeAll(async () => {
  await addLocalUser(CAROL);
  await addLocalUser(TESS);
});

test("the account page is accessible, closed and with the password form open, in every theme, mode and width", async ({ page }) => {
  test.setTimeout(180_000);
  await signInAsAdmin(page);
  for (const theme of THEMES) {
    for (const mode of MODES) {
      for (const width of WIDTHS) {
        const label = `account (${theme}, ${mode}, ${width}px)`;
        const csp = watchCsp(page);
        await open(page, "/account", theme, mode, width);
        await expect(page.getByRole("heading", { level: 1, name: "My account" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Change password" })).toBeVisible();
        await expectAccessible(page, label);
        await expectNoHorizontalScroll(page, label);

        await page.getByRole("button", { name: "Change password" }).click();
        await expect(page.getByLabel("Current password", { exact: true })).toBeFocused();
        await page.getByRole("button", { name: "Save password" }).click();
        await expect(page.getByRole("group", { name: "Check the highlighted fields." })).toBeFocused();
        await expectAccessible(page, `${label}, password form with errors`);
        await expectNoHorizontalScroll(page, `${label}, password form with errors`);

        await page.getByRole("button", { name: "Edit profile" }).click();
        await expect(page.getByLabel("Name", { exact: true })).toBeFocused();
        await page.getByLabel("E-mail", { exact: true }).fill("someone.else@example.invalid");
        await expect(page.getByLabel("Current password", { exact: true }).first()).toBeVisible();
        await expectAccessible(page, `${label}, profile form open`);
        await expectNoHorizontalScroll(page, `${label}, profile form open`);
        expect(csp).toEqual([]);
      }
    }
  }
});

test("the account page fits a 320 px screen in French", async ({ page }) => {
  await signInAsAdmin(page);
  await open(page, "/", "default", "light", 320);
  await page.evaluate(() => localStorage.setItem("yasad.language", "fr"));
  await page.goto("/account");
  await expect(page.getByRole("heading", { level: 1, name: "Mon compte" })).toBeVisible();
  await expect(page).toHaveTitle("Mon compte - YASAD");
  await expectNoHorizontalScroll(page, "account, fr");
  await page.getByRole("button", { name: "Changer le mot de passe" }).click();
  await page.getByRole("button", { name: "Modifier le profil" }).click();
  await expectNoHorizontalScroll(page, "account, fr, forms open");
  await expectAccessible(page, "account, fr, forms open");
  await page.evaluate(() => localStorage.removeItem("yasad.language"));
});

test("the account menu opens the account page with the focus on its heading", async ({ page }) => {
  setInstanceTheme("default");
  await signInAsAdmin(page);
  await page.goto("/");
  const trigger = page.getByRole("button", { name: `Account menu for ${ADMIN.name}` });
  await trigger.focus();
  await page.keyboard.press("Enter");
  // The menu opens on its first entry, My links; My account is the next one.
  await expect(page.getByRole("menuitem", { name: "My links" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "My account" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { level: 1, name: "My account" })).toBeFocused();
  await expect(page).toHaveTitle("My account - YASAD");
  await trigger.click();
  await expect(page.getByRole("menuitem", { name: "My account" })).toHaveAttribute("aria-current", "page");
});

test("a local account changes its password and its profile from the account page, with the keyboard", async ({ page, request }) => {
  setInstanceTheme("default");
  await signInAs(page, CAROL.email, CAROL.password);
  await page.goto("/account");
  const toggle = page.getByRole("button", { name: "Change password" });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByLabel("Current password", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  await page.keyboard.press("Enter");
  await page.keyboard.type(CAROL.password);
  await page.getByLabel("New password", { exact: true }).fill("carol's second passphrase");
  await page.getByLabel("Confirm new password", { exact: true }).fill("carol's second passphrase");
  await page.getByLabel("Confirm new password", { exact: true }).press("Enter");
  await expect(toggle).toBeFocused();
  await expect(page.getByRole("region", { name: "Password" }).getByRole("status")).toHaveText("Password changed. Your other sessions were closed.");

  const edit = page.getByRole("button", { name: "Edit profile" });
  await edit.focus();
  await page.keyboard.press("Enter");
  const name = page.getByLabel("Name", { exact: true });
  const email = page.getByLabel("E-mail", { exact: true });
  await expect(name).toBeFocused();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Carol Ann Shaw");
  await page.keyboard.press("Tab");
  await expect(email).toBeFocused();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(ADMIN.email);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Current password", { exact: true })).toBeFocused();
  await page.keyboard.type("carol's second passphrase");
  await page.keyboard.press("Enter");
  const summary = page.getByRole("group", { name: "Check the highlighted fields." });
  await expect(summary).toBeFocused();
  await expect(email).toHaveAttribute("aria-invalid", "true");

  // The summary link leads back to the field.
  await page.keyboard.press("Tab");
  await expect(summary.getByRole("link", { name: "E-mail: This e-mail address is already used by another account." })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(email).toBeFocused();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("carol.shaw@example.invalid");
  await page.keyboard.press("Enter");
  await expect(edit).toBeFocused();
  await expect(page.getByRole("region", { name: "Profile" }).getByRole("status")).toHaveText("Profile saved.");
  await expect(page.getByRole("button", { name: "Account menu for Carol Ann Shaw" })).toBeVisible();

  // A client without the session: the new e-mail and password sign in.
  const again = await request.post("/api/auth/sign-in/email", { data: { email: "carol.shaw@example.invalid", password: "carol's second passphrase" } });
  expect(again.ok(), await again.text()).toBe(true);
});

test("the temporary password step offers sign-out first, in the auth layout's focus order", async ({ page }) => {
  setInstanceTheme("default");
  await signInAs(page, TESS.email, TESS.password);
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { level: 1, name: "Choose your password" })).toBeVisible();
  await expect(page).toHaveTitle("Choose your password - YASAD");
  const order: string[] = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    order.push(await focused(page));
  }
  expect(order[0]).toContain("Skip to content");
  expect(order[1]).toMatch(/^a .*"YASAD"/);
  expect(order[2]).toMatch(/^button .*"Sign out"/);
  expect(order[3]).toMatch(/^select/);
  await expect(page.getByRole("group", { name: "Preferences" }).getByLabel("Language / Langue")).toBeFocused();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeFocused();
});
