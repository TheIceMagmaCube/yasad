import { expect, type Page, test } from "@playwright/test";

import {
  addLocalUser,
  expectAccessible,
  expectNoHorizontalScroll,
  focused,
  importCatalog,
  MODES,
  open,
  pinByApi,
  setInstanceTheme,
  signInAsAdmin,
  THEMES,
  unpinAllByApi,
  watchCsp,
  WIDTHS,
} from "./helpers";

test.describe.configure({ mode: "serial" });

// A person of its own: every project shares one database, and a pin left on the administrator would show its title
// twice on the home page of the other specs.
const PIA = { id: "pia", name: "Pia Pinner", email: "pia@example.invalid", password: "pia's own passphrase" };

/** Links of e2e/fixtures/home.yaml any signed-in person sees, in catalog order (the other three are hidden). */
const VISIBLE = ["status", "long-text", "members-only", "mail", "code", "chat", "wiki", "directory", "e-learning", "expenses", "monitoring", "lunch"];

/** Return the favourites panel (its aside landmark). */
const panel = (page: Page) => page.getByRole("complementary", { name: "Favourites" });

/** Return the titles of the favourites, in the panel's order. */
const panelTitles = (page: Page) => panel(page).getByRole("listitem").getByRole("link");

async function signInAsPia(page: Page): Promise<void> {
  const res = await page.request.post("/api/auth/sign-in/email", { data: { email: PIA.email, password: PIA.password } });
  expect(res.ok(), await res.text()).toBe(true);
}

/** Open the manage mode from the panel toggle, and wait for the bar. */
async function openManage(page: Page): Promise<void> {
  await page.locator("#pins-toggle").click();
  await expect(page.locator(".pins-bar")).toBeVisible();
}

/** Press `key` until the element `#id` has the focus, failing after `max` presses. */
async function pressUntil(page: Page, key: string, id: string, max = 40): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    if (await page.evaluate((target) => document.activeElement?.id === target, id)) return;
    await page.keyboard.press(key);
  }
  await expect(page.locator(`#${id}`)).toBeFocused();
}

test.beforeAll(async ({ browser }) => {
  // A retried worker runs this hook again on the same database: the person is then already there.
  try {
    await addLocalUser(PIA);
  } catch (error) {
    if (!String(error).includes("UNIQUE")) throw error;
  }
  const page = await browser.newPage();
  await signInAsAdmin(page);
  await importCatalog(page.request, "e2e/fixtures/home.yaml");
  await page.close();
});

test.beforeEach(async ({ page }) => {
  setInstanceTheme("default");
  await page.route("https://*.example.invalid/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Service</title><p>Service</p>" }),
  );
});

// The page's context is still signed in as Pia (or anonymous, with no pins to remove).
test.afterEach(async ({ page }) => {
  await unpinAllByApi(page.request);
});

for (const theme of THEMES) {
  for (const mode of MODES) {
    for (const width of WIDTHS) {
      test(`favourites are accessible (${theme}, ${mode}, ${width}px)`, async ({ page }) => {
        await signInAsPia(page);
        await pinByApi(page.request, ["mail", "wiki", "long-text"]);
        const csp = watchCsp(page);
        await open(page, "/", theme, mode, width);
        await expect(panelTitles(page)).toHaveText(["Mail", "Wiki", /^A link whose title/]);
        await expectAccessible(page, `favourites (${theme}, ${mode}, ${width}px)`);
        await openManage(page);
        await expect(page.locator("#pin-card-mail")).toBeVisible();
        await expectAccessible(page, `favourites, manage mode (${theme}, ${mode}, ${width}px)`);
        expect(csp).toEqual([]);
      });
    }
  }
}

test("three cards per row at 1280 px beside the panel", async ({ page }) => {
  await signInAsPia(page);
  await pinByApi(page.request, ["mail"]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(panelTitles(page)).toHaveText(["Mail"]);
  const cards = page.locator("#home-links .relief");
  const [first, second, third, fourth] = await Promise.all([0, 1, 2, 3].map(async (i) => (await cards.nth(i).boundingBox())!.y));
  expect(new Set([first, second, third]).size).toBe(1);
  expect(fourth).toBeGreaterThan(first!);
  // The panel is the right column, beside the cards.
  const panelBox = (await page.locator(".pins-panel").boundingBox())!;
  const lastCard = (await cards.nth(2).boundingBox())!;
  expect(panelBox.x).toBeGreaterThanOrEqual(lastCard.x + lastCard.width);
});

test("keyboard only: manage, pin two, move down, remove, Escape, reload", async ({ page }) => {
  await signInAsPia(page);
  await pinByApi(page.request, ["wiki"]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(panelTitles(page)).toHaveText(["Wiki"]);

  await pressUntil(page, "Tab", "pins-toggle");
  await page.keyboard.press("Enter");
  await expect(page.locator(".pins-bar")).toBeVisible();
  expect(await focused(page)).toBe('button#pins-toggle "Done, managing favourites"');

  // Two links pinned from their cards: the focus stays on each button, which now reads Pinned.
  for (const id of ["status", "long-text"]) {
    await pressUntil(page, "Tab", `pin-card-${id}`);
    await page.keyboard.press("Enter");
    await expect(page.locator(`#pin-card-${id}`)).toHaveAttribute("aria-label", /^Pinned: remove /);
    await expect(page.locator(`#pin-card-${id}`)).toBeFocused();
  }
  await expect(panelTitles(page)).toHaveText(["Wiki", "Status page", /^A link whose title/]);

  // Status page moved down: its Down button keeps the focus.
  await pressUntil(page, "Shift+Tab", "pin-down-status");
  await page.keyboard.press("Enter");
  await expect(panelTitles(page)).toHaveText(["Wiki", /^A link whose title/, "Status page"]);
  await expect(page.locator("#pin-down-status")).toBeFocused();
  await expect(page.locator("#pin-down-status")).toHaveAttribute("aria-disabled", "true");

  // Wiki removed: the focus goes to the next favourite's Remove.
  await pressUntil(page, "Shift+Tab", "pin-remove-wiki");
  await page.keyboard.press("Enter");
  await expect(panelTitles(page)).toHaveText([/^A link whose title/, "Status page"]);
  await expect(page.locator("#pin-remove-long-text")).toBeFocused();

  // Escape closes the mode and gives the focus back to the toggle.
  await page.keyboard.press("Escape");
  await expect(page.locator(".pins-bar")).toHaveCount(0);
  expect(await focused(page)).toBe('button#pins-toggle "Manage favourites"');

  await page.reload();
  await expect(panelTitles(page)).toHaveText([/^A link whose title/, "Status page"]);
});

test("at 320 px, pinning the last link keeps its button in view, above the bar", async ({ page }) => {
  await signInAsPia(page);
  await pinByApi(page.request, ["mail", "wiki"]);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await openManage(page);
  const button = page.locator("#pin-card-lunch");
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(button).toHaveAttribute("aria-label", "Pinned: remove Lunch menu from favourites");
  await expect(panelTitles(page)).toHaveText(["Mail", "Wiki", "Lunch menu"]);
  await expect(button).toBeFocused();
  await expect(button).toBeInViewport({ ratio: 1 });
  const place = await button.evaluate((el) => ({
    top: el.getBoundingClientRect().top,
    bottom: el.getBoundingClientRect().bottom,
    headerBottom: document.querySelector("header")!.getBoundingClientRect().bottom,
    barTop: document.querySelector(".pins-bar")!.getBoundingClientRect().top,
  }));
  expect(place.top).toBeGreaterThanOrEqual(place.headerBottom);
  expect(place.bottom).toBeLessThanOrEqual(place.barTop);
});

test("a person without favourites sees the invitation", async ({ page }) => {
  await signInAsPia(page);
  await page.goto("/");
  await expect(panel(page).getByText("Pin the links you open often with Manage.")).toBeVisible();
  await expect(panel(page).getByRole("list")).toHaveCount(0);
  await openManage(page);
  await expect(panel(page).getByText("No favourites. Choose Pin on a link.")).toBeVisible();
});

// 320 by 256 CSS pixels is a 1280 by 1024 window at 400 % zoom. The fixture has 15 links; a person sees 12 of them.
test("no horizontal scroll at 320 px and 400 % zoom with every visible link pinned and the mode open", async ({ page }) => {
  await signInAsPia(page);
  await pinByApi(page.request, VISIBLE);
  for (const height of [800, 256]) {
    await page.setViewportSize({ width: 320, height });
    await page.goto("/");
    await expect(panelTitles(page)).toHaveCount(VISIBLE.length);
    await openManage(page);
    await expectNoHorizontalScroll(page, `320x${height}, manage mode`);
    // Neither the panel nor, on the low screen, the bar sticks.
    expect(await page.locator(".pins-panel").evaluate((el) => getComputedStyle(el).position)).not.toBe("sticky");
    if (height === 256) expect(await page.locator(".pins-bar").evaluate((el) => getComputedStyle(el).position)).toBe("static");
  }
});

test("the focus is never hidden, with the sticky panel, in manage mode", async ({ page }) => {
  await signInAsPia(page);
  await pinByApi(page.request, VISIBLE);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await openManage(page);
  /** Return where the focused element sits in the content, or null when the focus is outside it or in the bar. */
  const place = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      if (!el?.closest("main") || el.closest(".pins-bar")) return null;
      const box = el.getBoundingClientRect();
      return {
        id: el.id || el.textContent?.slice(0, 40),
        top: box.top,
        bottom: box.bottom,
        headerBottom: document.querySelector("header")!.getBoundingClientRect().bottom,
        barTop: document.querySelector(".pins-bar")!.getBoundingClientRect().top,
      };
    });
  // From the toggle through the twelve favourites (four stops each) and the cards (two stops each), and back.
  let checked = 0;
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let i = 0; i < 80; i += 1) {
      await page.keyboard.press(key);
      const at = await place();
      if (!at) continue;
      checked += 1;
      expect(at.top, `${key} ${i}: ${at.id}`).toBeGreaterThanOrEqual(at.headerBottom);
      expect(at.bottom, `${key} ${i}: ${at.id}`).toBeLessThanOrEqual(at.barTop);
    }
  }
  expect(checked).toBeGreaterThan(80);

  await page.evaluate(() => window.scrollTo(0, 600));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  expect(await page.locator(".pins-panel").evaluate((el) => el.getBoundingClientRect().top)).toBeCloseTo(96, 0);
});

test("an anonymous visitor sees no panel and no Manage button", async ({ page }) => {
  const body = (await (await page.request.get("/api/home")).json()) as { signedIn: boolean; pins: string[] };
  expect(body.signedIn).toBe(false);
  expect(body.pins).toEqual([]);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Status page" })).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Manage/ })).toHaveCount(0);
    await expect(page.locator("#pins-toggle")).toHaveCount(0);
  }
});
