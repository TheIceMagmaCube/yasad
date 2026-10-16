import { expect, type Page, test } from "@playwright/test";

import {
  ADMIN,
  announcer,
  expectAccessible,
  expectFocusKept,
  expectNoHorizontalScroll,
  focused,
  MODES,
  open,
  setInstanceTheme,
  signInAsAdmin,
  THEMES,
  watchCsp,
  WIDTHS,
} from "./helpers";

test.describe.configure({ mode: "serial" });

const SIGN_IN_API = "**/api/auth/sign-in/email";
const WRONG = { status: 401, contentType: "application/json", body: JSON.stringify({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }) };

/** Wait for `ms` in the route handler, as a slow server would. */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Fill the sign-in form and send it with Enter; `passwordLabel` changes with the language. */
async function submitSignIn(page: Page, email: string, password: string, passwordLabel = "Password"): Promise<void> {
  const field = page.getByLabel(passwordLabel, { exact: true });
  if (email) await page.getByLabel("E-mail", { exact: true }).fill(email);
  if (password) await field.fill(password);
  await field.press("Enter");
}

test.describe("sign-in", () => {
  test("sends nothing when a field is empty, and reports both at once", async ({ page }) => {
    setInstanceTheme("default");
    const sent: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/auth/sign-in/email")) sent.push(req.url());
    });
    await page.goto("/sign-in");
    await page.getByLabel("Password", { exact: true }).press("Enter");
    const summary = page.getByRole("group", { name: "Check the highlighted fields." });
    await expect(summary).toBeFocused();
    await expect(summary.getByRole("link")).toHaveCount(2);
    await expect(page.getByLabel("E-mail", { exact: true })).toHaveAttribute("aria-invalid", "true");
    expect(sent).toEqual([]);
  });

  test("marks both fields on a wrong password, empties it, and links to it", async ({ page }) => {
    setInstanceTheme("default");
    const csp = watchCsp(page);
    await page.goto("/sign-in");
    await submitSignIn(page, "nobody@example.invalid", "not the right password");
    const summary = page.getByRole("group", { name: "Wrong e-mail or password." });
    await expect(summary).toBeFocused();
    const password = page.getByLabel("Password", { exact: true });
    await expect(password).toHaveValue("");
    await expect(password).toHaveAttribute("type", "password");
    for (const field of [page.getByLabel("E-mail", { exact: true }), password]) {
      await expect(field).toHaveAttribute("aria-invalid", "true");
      await expect(field).toHaveAccessibleDescription("Wrong e-mail or password.");
    }
    await page.keyboard.press("Tab");
    await expect(summary.getByRole("link", { name: "Enter your password again" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(password).toBeFocused();
    expect(csp).toEqual([]);
  });

  test("names its progress, keeps the focus and announces a slow sign-in", async ({ page }) => {
    setInstanceTheme("default");
    await page.route(SIGN_IN_API, async (route) => {
      await delay(800);
      await route.fulfill(WRONG);
    });
    await page.goto("/sign-in");
    await page.getByLabel("E-mail", { exact: true }).fill("nobody@example.invalid");
    await page.getByLabel("Password", { exact: true }).fill("not the right password");
    const button = page.getByRole("button", { name: "Sign in" });
    await button.focus();
    await expectFocusKept(page, async () => {
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: "Signing in…" })).toHaveAttribute("aria-disabled", "true");
    });
    await expect(announcer(page)).toHaveText("Signing in…");
    await expect(page.getByRole("group", { name: "Wrong e-mail or password." })).toBeFocused();
  });

  test("shows the password with the keyboard", async ({ page }) => {
    setInstanceTheme("default");
    await page.goto("/sign-in");
    const password = page.getByLabel("Password", { exact: true });
    await password.fill("a secret");
    await password.press("Tab");
    const show = page.getByRole("button", { name: "Show password" });
    await expect(show).toBeFocused();
    await page.keyboard.press("Space");
    await expect(password).toHaveAttribute("type", "text");
    await expect(show).toHaveAttribute("aria-pressed", "true");
    await expect(show).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(password).toHaveAttribute("type", "password");
  });

  test("is accessible with errors in every theme, mode and width", async ({ page }) => {
    test.setTimeout(120_000);
    await page.route(SIGN_IN_API, (route) => route.fulfill(WRONG));
    for (const theme of THEMES) {
      for (const mode of MODES) {
        for (const width of WIDTHS) {
          const label = `sign-in error (${theme}, ${mode}, ${width}px)`;
          const csp = watchCsp(page);
          await open(page, "/sign-in", theme, mode, width);
          await submitSignIn(page, "nobody@example.invalid", "not the right password");
          await expect(page.getByRole("group", { name: "Wrong e-mail or password." })).toBeFocused();
          await expectAccessible(page, label);
          await expectNoHorizontalScroll(page, label);
          expect(csp).toEqual([]);
        }
      }
    }
    await page.evaluate(() => localStorage.setItem("yasad.language", "fr"));
    await open(page, "/sign-in", "default", "light", 320);
    await submitSignIn(page, "nobody@example.invalid", "not the right password", "Mot de passe");
    await expect(page.getByRole("group", { name: "E-mail ou mot de passe incorrect." })).toBeFocused();
    await expectNoHorizontalScroll(page, "sign-in error in French");
    await page.evaluate(() => localStorage.removeItem("yasad.language"));
  });
});

/**
 * Open "/" with the instance theme cached in the browser: the instance settings arrive with the first view, so
 * the loading and unreachable screens take the theme from the cache. The page must already be on the app origin.
 */
async function openCached(page: Page, theme: string, mode: "light" | "dark", width: number, path = "/"): Promise<void> {
  await page.evaluate((t) => localStorage.setItem("yasad.instanceTheme", t), theme);
  await page.emulateMedia({ colorScheme: mode });
  await page.setViewportSize({ width, height: 800 });
  await page.goto(path);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
}

test.describe("loading and unreachable server", () => {
  test("the loading shell shows after 300 ms, accessibly", async ({ page }) => {
    test.setTimeout(120_000);
    await page.route("**/api/auth/get-session", async (route) => {
      await delay(10_000);
      await route.continue().catch(() => {});
    });
    await page.goto("/");
    for (const theme of THEMES) {
      for (const mode of MODES) {
        for (const width of WIDTHS) {
          const label = `loading shell (${theme}, ${mode}, ${width}px)`;
          const csp = watchCsp(page);
          await openCached(page, theme, mode, width);
          const shell = page.locator('[data-slot="loading-shell"]');
          await expect(shell).toBeVisible();
          await expect(page.locator('[data-slot="page-skeleton"]')).toBeVisible();
          await expect(page).toHaveTitle("Loading… - YASAD");
          await expect(announcer(page)).toHaveText("Loading…");
          await expectAccessible(page, label);
          await expectNoHorizontalScroll(page, label);
          expect(csp).toEqual([]);
        }
      }
    }
  });

  test("the unreachable screen is accessible, keeps the focus on Retry and recovers", async ({ page }) => {
    test.setTimeout(120_000);
    await page.route("**/api/**", (route) => route.abort());
    await page.goto("/");
    for (const theme of THEMES) {
      for (const mode of MODES) {
        for (const width of WIDTHS) {
          const label = `unreachable (${theme}, ${mode}, ${width}px)`;
          const csp = watchCsp(page);
          // On /sign-in, the recovered screen is the same whether or not some links are public.
          await openCached(page, theme, mode, width, "/sign-in");
          await expect(page.getByRole("heading", { level: 1, name: "Server unreachable" })).toBeVisible();
          await expectAccessible(page, label);
          await expectNoHorizontalScroll(page, label);
          expect(csp).toEqual([]);
        }
      }
    }
    await page.evaluate(() => localStorage.setItem("yasad.language", "fr"));
    await openCached(page, "default", "light", 320, "/sign-in");
    await expect(page.getByRole("heading", { level: 1, name: "Serveur injoignable" })).toBeVisible();
    await expect(page).toHaveTitle("Serveur injoignable - YASAD");
    await expectNoHorizontalScroll(page, "unreachable in French");
    await page.evaluate(() => localStorage.removeItem("yasad.language"));
    await openCached(page, "default", "light", 1280, "/sign-in");
    await expect(page).toHaveTitle("Server unreachable - YASAD");
    const retry = page.getByRole("button", { name: "Try again" });
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toHaveText("The server still does not respond.");
    await expect(retry).toBeFocused();

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeFocused();
  });
});

test.describe("session", () => {
  test("an ended session asks to sign in again, then comes back to the same page with the focus on its heading", async ({ page, context }) => {
    setInstanceTheme("default");
    await page.setViewportSize({ width: 1280, height: 800 });
    await signInAsAdmin(page);
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { level: 1, name: /^Administration\s*, Users$/ })).toBeVisible();
    await context.clearCookies();
    await page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Groups" }).click();
    const notice = page.getByRole("group", { name: "Your session has ended. Sign in again to continue." });
    await expect(notice).toBeFocused();
    await expect(page).toHaveURL(/\/admin\/groups$/);
    await expectAccessible(page, "sign-in after the session ended");

    await submitSignIn(page, ADMIN.email, ADMIN.password);
    await expect(page.getByRole("heading", { level: 1, name: /^Administration\s*, Groups$/ })).toBeFocused();
    await expect(page).toHaveURL(/\/admin\/groups$/);
    expect(await focused(page)).toContain("Administration");
  });
});
