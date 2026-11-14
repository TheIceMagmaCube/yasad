import { DatabaseSync } from "node:sqlite";

import { expect, test } from "@playwright/test";

import { E2E_DB } from "../playwright.config";
import { announcer, expectAccessible, expectNoHorizontalScroll, MODES, open, setInstanceTheme, signInAsAdmin, THEMES, watchCsp, WIDTHS } from "./helpers";

test.describe.configure({ mode: "serial" });

// A logo with a <style>, as most exported logos have: shown in an <img>, the page's CSP must not apply inside it.
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><style>.mark { fill: #1a1824; }</style><rect class="mark" x="4" y="4" width="16" height="16"/></svg>`;

/** Put the instance back to YASAD's defaults: the database is shared by every project. */
function resetInstance(): void {
  const db = new DatabaseSync(E2E_DB, { timeout: 5000 });
  try {
    db.exec("delete from setting where key in ('instance.title', 'instance.logo', 'instance.theme')");
  } finally {
    db.close();
  }
}

test.afterAll(resetInstance);

test("an admin sets the title, logo and theme, which the sign-in page and the tab icon follow at once", async ({ page, browser }) => {
  resetInstance();
  const csp = watchCsp(page);
  await signInAsAdmin(page);
  await page.goto("/admin/appearance");
  await expect(page.getByRole("heading", { level: 1, name: "Appearance" })).toBeVisible();

  const title = page.getByRole("region", { name: "Title" });
  await title.getByLabel("Instance title").fill("Harbour lab");
  await title.getByRole("button", { name: "Save the title" }).click();
  await expect(announcer(page)).toHaveText("Title saved.");
  await expect(page.locator('[data-slot="brand"]')).toContainText("Harbour lab");

  const logo = page.getByRole("region", { name: "Logo" });
  await logo.getByLabel("Choose an image").setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from(LOGO) });
  const preview = logo.getByRole("img", { name: "New logo" });
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await logo.getByRole("button", { name: "Save the logo" }).click();
  await expect(announcer(page)).toHaveText("Logo saved.");
  const src = await logo.getByRole("img", { name: "Current logo" }).getAttribute("src");
  expect(src).toMatch(/^\/api\/images\/[0-9a-f]{32}$/);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", `/api/instance/icon?v=${src!.slice("/api/images/".length)}`);
  await expect(page.locator(`[data-slot="brand"] img[src="${src}"]`)).toBeVisible();

  const theme = page.getByRole("region", { name: "Default theme" });
  await theme.getByRole("radio", { name: "Dusk" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "default");
  await theme.getByRole("button", { name: "Save the theme" }).click();
  await expect(announcer(page)).toHaveText("Theme saved.");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dusk");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", /^#[0-9a-f]{6}$/);

  // Someone else, not signed in, on the sign-in page: no restart, no cache to wait for.
  const visitor = await browser.newPage();
  const visitorCsp = watchCsp(visitor);
  await visitor.goto("/sign-in");
  await expect(visitor.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(visitor).toHaveTitle(/Harbour lab$/);
  await expect(visitor.locator(`img[src="${src}"]`).first()).toBeVisible();
  await expect(visitor.locator("html")).toHaveAttribute("data-theme", "dusk");
  const icon = await visitor.request.get("/api/instance/icon", { maxRedirects: 0 });
  expect(icon.status()).toBe(302);
  expect(icon.headers().location).toBe(src);
  await visitor.close();

  expect(csp).toEqual([]);
  expect(visitorCsp).toEqual([]);
});

test("the appearance page is accessible in every theme, mode and width", async ({ page }) => {
  test.setTimeout(180_000);
  await signInAsAdmin(page);
  for (const theme of THEMES) {
    for (const mode of MODES) {
      for (const width of WIDTHS) {
        const label = `appearance (${theme}, ${mode}, ${width}px)`;
        const csp = watchCsp(page);
        await open(page, "/admin/appearance", theme, mode, width);
        await expect(page.getByRole("region", { name: "Default theme" })).toBeVisible();
        await expectAccessible(page, label);
        await expectNoHorizontalScroll(page, label);
        expect(csp).toEqual([]);
      }
    }
  }
  setInstanceTheme("default");
});
