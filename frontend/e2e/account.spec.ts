import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

import { BASE_URL } from "../playwright.config";
import { addLocalUser, ADMIN, announcer, expectAccessible, expectNoHorizontalScroll, focused, MODES, open, setInstanceTheme, signInAsAdmin, THEMES, watchCsp, WIDTHS } from "./helpers";

test.describe.configure({ mode: "serial" });

const CAROL = { id: "carol", name: "Carol Shaw", email: "carol@example.invalid", password: "carol's first passphrase" };
const TESS = { id: "tess", name: "Tess", email: "tess@example.invalid", password: "tess temporary password", mustChangePassword: true };

/** Sign the page's browser context in through the API. */
async function signInAs(page: Page, email: string, password: string): Promise<void> {
  const res = await page.request.post("/api/auth/sign-in/email", { data: { email, password } });
  expect(res.ok(), await res.text()).toBe(true);
}

/** A local group with spaces in its name: each name must stay on one line of the list. */
const NIGHT_SHIFT = "Night Shift Staff";

/**
 * Make the signed-in administrator of `page` a member of a new local group named `name`, through the admin API.
 * Return the cleanup, which deletes the group.
 */
async function holdLocalGroup(page: Page, name: string): Promise<() => Promise<void>> {
  const session = await page.request.get("/api/auth/get-session");
  expect(session.ok(), await session.text()).toBe(true);
  const adminId = ((await session.json()) as { user: { id: string } }).user.id;
  const created = await page.request.post("/api/admin/groups", { data: { name }, headers: { Origin: BASE_URL } });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = ((await created.json()) as { group: { id: string } }).group;
  const added = await page.request.put(`/api/admin/groups/${id}/members/${adminId}`, { data: {}, headers: { Origin: BASE_URL } });
  expect(added.ok(), await added.text()).toBe(true);
  return async () => {
    const removed = await page.request.delete(`/api/admin/groups/${id}`, { data: {}, headers: { Origin: BASE_URL } });
    expect(removed.ok(), await removed.text()).toBe(true);
  };
}

test.beforeAll(async () => {
  await addLocalUser(CAROL);
  await addLocalUser(TESS);
});

test("the account page is accessible, closed and with the password form open, in every theme, mode and width", async ({ page }) => {
  test.setTimeout(180_000);
  await signInAsAdmin(page);
  const release = await holdLocalGroup(page, NIGHT_SHIFT);
  try {
    for (const theme of THEMES) {
      for (const mode of MODES) {
        for (const width of WIDTHS) {
          const label = `account (${theme}, ${mode}, ${width}px)`;
          const csp = watchCsp(page);
          await open(page, "/account", theme, mode, width);
          await expect(page.getByRole("heading", { level: 1, name: ADMIN.name })).toBeVisible();
          await expect(page.getByRole("button", { name: "Change password" })).toBeVisible();
          await expect(page.getByRole("list", { name: "Local groups (1)" })).toContainText(NIGHT_SHIFT);
          await expectAccessible(page, label);
          await expectNoHorizontalScroll(page, label);

          await page.getByRole("button", { name: "Change password" }).click();
          await expect(page.getByLabel("Current password", { exact: true })).toBeFocused();
          await page.getByRole("button", { name: "Save password" }).click();
          await expect(page.getByRole("group", { name: "Check the highlighted fields." })).toBeFocused();
          await expectAccessible(page, `${label}, password form with errors`);
          await expectNoHorizontalScroll(page, `${label}, password form with errors`);

          // Opening the e-mail form closes the password one: one setting is edited at a time.
          await page.getByRole("button", { name: "Edit: E-mail" }).click();
          const email = page.getByRole("textbox", { name: "E-mail", exact: true });
          await expect(email).toBeFocused();
          await email.fill("someone.else@example.invalid");
          await expect(page.getByLabel("Current password", { exact: true })).toBeVisible();
          await expectAccessible(page, `${label}, e-mail form open`);
          await expectNoHorizontalScroll(page, `${label}, e-mail form open`);
          expect(csp).toEqual([]);
        }
      }
    }
  } finally {
    await release();
  }
});

test("the account page fits a 320 px screen in French", async ({ page }) => {
  await signInAsAdmin(page);
  const release = await holdLocalGroup(page, NIGHT_SHIFT);
  try {
    await open(page, "/", "default", "light", 320);
    await page.evaluate(() => localStorage.setItem("yasad.language", "fr"));
    await page.goto("/account");
    await expect(page.getByRole("heading", { level: 1, name: ADMIN.name })).toBeVisible();
    await expect(page).toHaveTitle("Mon compte - YASAD");
    await expect(page.getByRole("heading", { level: 2, name: "Mes groupes" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Groupes locaux (1)" })).toContainText(NIGHT_SHIFT);
    await expect(page.getByRole("term").filter({ hasText: "@everyone" })).toBeVisible();
    await expectNoHorizontalScroll(page, "account, fr");
    await page.getByRole("button", { name: "Changer le mot de passe" }).click();
    await expectNoHorizontalScroll(page, "account, fr, password form open");
    await page.getByRole("button", { name: "Modifier : E-mail" }).click();
    await expectNoHorizontalScroll(page, "account, fr, e-mail form open");
    await expectAccessible(page, "account, fr, e-mail form open");
    await page.evaluate(() => localStorage.removeItem("yasad.language"));
  } finally {
    await release();
  }
});

/** Import the catalog `yaml` through the admin API signed in on `request`: preview, then apply. */
async function applyCatalog(request: APIRequestContext, yaml: string): Promise<void> {
  const preview = await request.post("/api/admin/catalog", { data: { yaml, dryRun: true } });
  expect(preview.ok(), await preview.text()).toBe(true);
  const { baseVersion } = (await preview.json()) as { baseVersion: string };
  const applied = await request.post("/api/admin/catalog", { data: { yaml, dryRun: false, baseVersion } });
  expect(applied.ok(), await applied.text()).toBe(true);
}

/**
 * Empty the catalog as the administrator, through the API, so that a person without groups gets the empty home
 * whichever project ran before (the shell project imports a catalog open to every signed-in person).
 * Return the cleanup, which imports the previous catalog again.
 */
async function emptyCatalog(request: APIRequestContext): Promise<() => Promise<void>> {
  const signedIn = await request.post("/api/auth/sign-in/email", { data: { email: ADMIN.email, password: ADMIN.password } });
  expect(signedIn.ok(), await signedIn.text()).toBe(true);
  const exported = await request.get("/api/admin/catalog");
  expect(exported.ok(), await exported.text()).toBe(true);
  const previous = await exported.text();
  await applyCatalog(request, "version: 1\ncategories: []\n");
  return () => applyCatalog(request, previous);
}

test("a person without groups is led from the empty home to their groups, in every theme, mode and width", async ({ page, request }) => {
  test.setTimeout(120_000);
  const restore = await emptyCatalog(request);
  try {
    await checkEmptyHome(page);
  } finally {
    await restore();
  }
});

async function checkEmptyHome(page: Page): Promise<void> {
  await signInAs(page, CAROL.email, CAROL.password);
  for (const theme of THEMES) {
    for (const mode of MODES) {
      for (const width of WIDTHS) {
        const label = `empty home, no groups (${theme}, ${mode}, ${width}px)`;
        const csp = watchCsp(page);
        await open(page, "/", theme, mode, width);
        await expect(page.getByRole("heading", { level: 2, name: "No access yet" })).toBeVisible();
        await expect(page.getByRole("link", { name: "See my groups" })).toBeVisible();
        await expectAccessible(page, label);
        await expectNoHorizontalScroll(page, label);
        expect(csp).toEqual([]);
      }
    }
  }

  setInstanceTheme("default");
  await page.goto("/");
  const link = page.getByRole("link", { name: "See my groups" });
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/account#groups$/);
  await expect(page.getByRole("heading", { level: 2, name: "My groups" })).toBeFocused();
}

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
  await expect(page.getByRole("heading", { level: 1, name: ADMIN.name })).toBeFocused();
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
  const status = page.locator('[data-slot="account-status"]');
  await expect(status).toHaveText("Password changed. Your other sessions were closed.");
  await expect(announcer(page)).toHaveText("Password changed. Your other sessions were closed.");

  const editName = page.getByRole("button", { name: "Edit: Name" });
  await editName.focus();
  await page.keyboard.press("Enter");
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  await expect(name).toBeFocused();
  await expect(page.getByRole("textbox", { name: "E-mail", exact: true })).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Carol Ann Shaw");
  await page.keyboard.press("Enter");
  await expect(editName).toBeFocused();
  await expect(status).toHaveText("Profile saved.");
  await expect(page.getByRole("button", { name: "Account menu for Carol Ann Shaw" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Carol Ann Shaw" })).toBeVisible();

  const edit = page.getByRole("button", { name: "Edit: E-mail" });
  await edit.focus();
  await page.keyboard.press("Enter");
  const email = page.getByRole("textbox", { name: "E-mail", exact: true });
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
  await expect(status).toHaveText("Profile saved.");
  await expect(page.getByRole("listitem", { name: "E-mail" })).toContainText("carol.shaw@example.invalid");

  // A client without the session: the new e-mail and password sign in.
  const again = await request.post("/api/auth/sign-in/email", { data: { email: "carol.shaw@example.invalid", password: "carol's second passphrase" } });
  expect(again.ok(), await again.text()).toBe(true);
});

test("language and appearance change from the account page with the keyboard, and stay", async ({ page }) => {
  setInstanceTheme("default");
  await signInAsAdmin(page);
  await page.goto("/account");
  const french = page.getByRole("group", { name: "Language" }).getByRole("button", { name: "Français" });
  await expect(french).toHaveAttribute("aria-pressed", "false");
  await french.focus();
  await page.keyboard.press("Enter");
  // The page is now in French: the group is named again in that language.
  await expect(page.getByRole("group", { name: "Langue" }).getByRole("button", { name: "Français" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.getByRole("button", { name: "Changer le mot de passe" })).toBeVisible();

  const appearance = page.getByRole("group", { name: "Apparence" });
  await appearance.getByRole("radio", { name: "Système" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(appearance.getByRole("radio", { name: "Clair" })).toBeChecked();
  await page.keyboard.press("ArrowRight");
  await expect(appearance.getByRole("radio", { name: "Sombre" })).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  await expect(page.getByRole("group", { name: "Apparence" }).getByRole("radio", { name: "Sombre" })).toBeChecked();
  await page.evaluate(() => {
    localStorage.removeItem("yasad.language");
    localStorage.removeItem("yasad.mode");
  });
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
