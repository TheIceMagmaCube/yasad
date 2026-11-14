import { DatabaseSync } from "node:sqlite";

import { expect, test } from "@playwright/test";

import { BASE_URL, E2E_DB } from "../playwright.config";
import { announcer, expectAccessible, expectNoHorizontalScroll, MODES, open, setInstanceTheme, signInAsAdmin, THEMES, watchCsp, WIDTHS } from "./helpers";

test.describe.configure({ mode: "serial" });

const CATEGORY = "e2e-icons";
const LINK = "e2e-icon-link";
const TITLE = "Harbour status";
// A dark mark with a <style>, as exported logos have: on the neutral plate it stays visible in dark mode, and shown
// in an <img>, the page's CSP must not apply inside it.
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><style>.mark { fill: #1a1824; }</style><circle class="mark" cx="12" cy="12" r="9"/></svg>`;

/** Remove the category and link of this file: the database is shared by every project. */
function cleanUp(): void {
  const db = new DatabaseSync(E2E_DB, { timeout: 5000 });
  try {
    db.exec(`delete from link where id = '${LINK}'; delete from category where id = '${CATEGORY}'`);
  } finally {
    db.close();
  }
}

test.afterAll(cleanUp);

test("an admin uploads a link icon on the link page, and the home page shows it to a visitor", async ({ page, browser }) => {
  cleanUp();
  const csp = watchCsp(page);
  await signInAsAdmin(page);
  const headers = { Origin: BASE_URL };
  const category = await page.request.post("/api/admin/categories", { data: { id: CATEGORY, title: "Harbour", groups: ["@everyone"] }, headers });
  expect(category.ok(), await category.text()).toBe(true);
  const link = await page.request.post("/api/admin/links", {
    data: { id: LINK, title: TITLE, url: "https://status.example.invalid", categoryId: CATEGORY, groups: ["@everyone"] },
    headers,
  });
  expect(link.ok(), await link.text()).toBe(true);

  await page.goto(`/admin/links/${LINK}`);
  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  const icon = page.getByRole("group", { name: "Icon" });
  await icon.getByRole("radio", { name: "Upload an image" }).check();
  await icon.getByLabel("Choose an image").setInputFiles({ name: "status.svg", mimeType: "image/svg+xml", buffer: Buffer.from(ICON) });
  await expect(announcer(page)).toHaveText("Image ready: save to apply it.");
  const preview = page.locator('[data-slot="icon-preview"]');
  await expect(preview).toContainText("Uploaded image, 24 × 24 px");
  const src = await preview.locator("img").getAttribute("src");
  expect(src).toMatch(/^\/api\/images\/[0-9a-f]{32}$/);
  await expect.poll(() => preview.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(announcer(page)).toHaveText(`Saved: ${TITLE}.`);

  // Someone else, not signed in: the home page draws the image from YASAD, on the neutral plate.
  const visitor = await browser.newPage();
  const visitorCsp = watchCsp(visitor);
  await visitor.goto("/");
  const title = visitor.getByRole("link", { name: TITLE, exact: true });
  await expect(title).toBeVisible();
  // The tile is a sibling of the link, in the card that holds both.
  const tile = title.locator("xpath=ancestor::div[1]").locator('[data-slot="link-icon"]');
  await expect(tile).toHaveAttribute("aria-hidden", "true");
  const image = tile.locator(`[data-slot="link-icon-plate"] img[src="${src}"]`);
  await expect(image).toHaveAttribute("alt", "");
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await visitor.close();

  expect(csp).toEqual([]);
  expect(visitorCsp).toEqual([]);
});

test("the home page with an uploaded icon and the link page are accessible in every theme, mode and width", async ({ page }) => {
  test.setTimeout(240_000);
  await signInAsAdmin(page);
  for (const theme of THEMES) {
    for (const mode of MODES) {
      for (const width of WIDTHS) {
        const csp = watchCsp(page);
        const home = `home with an uploaded icon (${theme}, ${mode}, ${width}px)`;
        await open(page, "/", theme, mode, width);
        await expect(page.locator('[data-slot="link-icon-plate"] img').first()).toBeVisible();
        await expectAccessible(page, home);
        await expectNoHorizontalScroll(page, home);

        const item = `link page with an uploaded icon (${theme}, ${mode}, ${width}px)`;
        await open(page, `/admin/links/${LINK}`, theme, mode, width);
        await expect(page.locator('[data-slot="icon-preview"] img')).toBeVisible();
        await expectAccessible(page, item);
        await expectNoHorizontalScroll(page, item);
        expect(csp).toEqual([]);
      }
    }
  }
  setInstanceTheme("default");
});
