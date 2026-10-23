import { expect, type Page, test } from "@playwright/test";

import { ICONS_BASE } from "../src/icons-base";
import { addTemporaryUser, ADMIN, announcer, expectAccessible, expectNoHorizontalScroll, importCatalog, MODES, open, setInstanceTheme, setLinkStatus, signInAsAdmin, TEMPORARY, THEMES, watchCsp, WIDTHS } from "./helpers";

test.describe.configure({ mode: "serial" });

const signIn = signInAsAdmin;

/** Categories of e2e/fixtures/home.yaml, in order, as the admin sees them (the admin holds no local group). */
const HOME_CATEGORIES = ["Public", "Everyday", "Documentation", "People", "Money", "Operations", "Miscellaneous"];
/** Links of the fixture the admin may not see: two on local:Nobody, one inactive. */
const HIDDEN_LINKS = ["Secret plans", "Secret vault", "Retired tool"];
/** Keyword of a hidden link: it must never reach the browser either. */
const HIDDEN_KEYWORD = "kw-hidden-marker";

const HOUR = 60 * 60_000;

/**
 * Give checked links of the home fixture a stored result: up, down, up but too old (status unknown) and checked but
 * never run (status unknown), plus a hidden link whose result must stay hidden with it. Seeded again by each test, so
 * the fresh results are never older than the interval whatever the time the earlier tests took.
 */
function seedHomeStatuses(): void {
  const now = Date.now();
  setLinkStatus([
    { linkId: "wiki", state: "up", httpStatus: 200, checkedAt: now },
    { linkId: "directory", state: "down", reason: "http_error", httpStatus: 502, checkedAt: now },
    { linkId: "e-learning", state: "up", httpStatus: 200, checkedAt: now - 48 * HOUR },
    { linkId: "expenses", state: null, checkedAt: null },
    { linkId: "secret-plans", state: "down", reason: "http_error", httpStatus: 502, checkedAt: now },
  ]);
}

/** Return the card of the home link titled `title`. */
const cardOf = (page: Page, title: string) => page.locator("#home-links .relief").filter({ has: page.getByRole("link", { name: title, exact: true }) });

/** Return the header search field. */
const searchField = (page: Page) => page.getByRole("combobox", { name: "Search links" });

/** Return the search result options (the footer's language and appearance selects have options too). */
const results = (page: Page) => page.getByRole("banner").getByRole("option");

/** Reach the search field as a person would at this width: the toggle button on a phone, "/" elsewhere. */
async function openSearch(page: Page, width: number): Promise<void> {
  if (width === 320) await page.getByRole("button", { name: "Search", exact: true }).click();
  else await page.keyboard.press("/");
  await expect(searchField(page)).toBeFocused();
}

/** Check the page accessibly with a query that finds results (first one active), then with one that finds none. */
async function expectSearchAccessible(page: Page, query: string, width: number, label: string): Promise<void> {
  await openSearch(page, width);
  const field = searchField(page);
  await field.fill(query);
  await expect(field).toHaveAttribute("aria-expanded", "true");
  await expect(field).toHaveAttribute("aria-activedescendant", /opt-0$/);
  await expectAccessible(page, `${label}, search results`);
  if (width === 320) expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await field.fill("zzzz");
  await expect(page.getByText("No link matches zzzz")).toBeVisible();
  await expectAccessible(page, `${label}, search with no results`);
  await field.press("Escape");
}

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
        await expect(page.getByRole("heading", { name: "My links", level: 1 })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Your catalog is empty", level: 2 })).toBeVisible();
        const steps = page.getByRole("main").getByRole("list").getByRole("link");
        await expect(steps).toHaveText(["Import the catalog", "Create the groups", "Add people to the groups"]);
        await expectAccessible(page, "home, empty catalog");
        await page.getByRole("button", { name: `Account menu for ${ADMIN.name}` }).click();
        await expect(page.getByRole("menu")).toBeVisible();
        await expectAccessible(page, "home, account menu open");
        expect(csp).toEqual([]);
      });
    }
  }
}

test("the home fixture imports through the admin API", async ({ page }) => {
  await signIn(page);
  await importCatalog(page.request, "e2e/fixtures/home.yaml");
});

for (const theme of THEMES) {
  for (const mode of MODES) {
    for (const width of WIDTHS) {
      test(`home shows the allowed links, accessibly (${theme}, ${mode}, ${width}px)`, async ({ page }) => {
        seedHomeStatuses();
        await signIn(page);
        const csp = watchCsp(page);
        await open(page, "/", theme, mode, width);
        const main = page.getByRole("main");
        // The favourites panel has its own h2, before the categories.
        await expect(page.locator("#home-links").getByRole("heading", { level: 2 })).toHaveText(HOME_CATEGORIES);
        for (const title of HIDDEN_LINKS) await expect(main.getByText(title)).toHaveCount(0);
        const body = await (await page.request.get("/api/home")).text();
        for (const title of HIDDEN_LINKS) expect(body).not.toContain(title);
        // The seeded hidden link's result stays out, and no reason or HTTP status reaches the home page.
        for (const marker of ["secret-plans", "http_error", "httpStatus"]) expect(body).not.toContain(marker);

        // Each state shows a word and when it was checked, read after the description through aria-describedby.
        await expect(cardOf(page, "Wiki").getByText("Up", { exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: "Wiki", exact: true })).toHaveAccessibleDescription(/^Status:\s*Up\s*,\s*checked\s/);
        await expect(cardOf(page, "Wiki").locator("time")).toHaveAttribute("datetime", /Z$/);
        await expect(cardOf(page, "Wiki").locator("time")).not.toHaveAttribute("title");
        await expect(cardOf(page, "Directory").getByText("Down", { exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: "Directory", exact: true })).toHaveAccessibleDescription(/^Status:\s*Down\s*,\s*checked\s/);
        await expect(cardOf(page, "Équipe e-learning").getByText("Status unknown", { exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: "Équipe e-learning", exact: true })).toHaveAccessibleDescription(
          /^Training courses\s+Status:\s*Status unknown\s*,\s*checked\s/,
        );
        await expect(cardOf(page, "Expenses").getByText("not checked yet")).toBeVisible();
        await expect(page.getByRole("link", { name: "Expenses", exact: true })).toHaveAccessibleDescription(/^Status:\s*Status unknown\s*,\s*not checked yet$/);
        await expect(page.getByRole("link", { name: "Mail", exact: true })).toHaveAccessibleDescription("Company mailbox");
        // The down band runs across the bottom of its card, edge to edge, at both widths.
        const directory = (await cardOf(page, "Directory").boundingBox())!;
        const band = (await cardOf(page, "Directory").locator('[id$="-status"]').boundingBox())!;
        for (const [side, a, b] of [
          ["left", band.x, directory.x],
          ["right", band.x + band.width, directory.x + directory.width],
          ["bottom", band.y + band.height, directory.y + directory.height],
        ] as const) {
          expect(Math.abs(a - b), `down band ${side} edge`).toBeLessThanOrEqual(1);
        }

        const everyday = page.getByRole("region", { name: "Everyday" });
        // The icon sits in the card, beside the title link.
        const card = (name: string) => everyday.locator(".relief").filter({ has: page.getByRole("link", { name, exact: true }) });
        await expect(card("Mail").locator("svg")).toBeVisible();
        await expect(card("Code").locator("svg")).toBeVisible();
        await expect(card("Chat").locator('[data-slot="link-icon"] [data-initial]')).toHaveAttribute("data-initial", "C");
        await expect(card("Chat").locator("svg")).toHaveCount(0);

        await expectAccessible(page, "home with links");
        await expectSearchAccessible(page, "mail", width, `home (${theme}, ${mode}, ${width}px)`);
        expect(csp).toEqual([]);
        if (width === 320) {
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
        } else {
          const cards = everyday.getByRole("link");
          const ys = await Promise.all([0, 1, 2].map(async (i) => (await cards.nth(i).boundingBox())!.y));
          expect(new Set(ys).size).toBe(1);
        }
      });
    }
  }
}

test("an anonymous visitor sees the public links only, accessibly", async ({ page }) => {
  const body = (await (await page.request.get("/api/home")).json()) as { signedIn: boolean; categories: { title: string }[] };
  expect(body.signedIn).toBe(false);
  expect(body.categories.map((c) => c.title)).toEqual(["Public"]);
  expect(JSON.stringify(body)).not.toContain("Members only");
  expect(JSON.stringify(body)).not.toContain("Mail");

  for (const theme of THEMES) {
    for (const mode of MODES) {
      for (const width of WIDTHS) {
        const csp = watchCsp(page);
        await open(page, "/", theme, mode, width);
        await expect(page.getByRole("heading", { name: "Links", level: 1 })).toBeVisible();
        await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText(["Public"]);
        await expect(page.getByRole("link", { name: "Status page" })).toBeVisible();
        await expect(page.getByText("Members only")).toHaveCount(0);
        await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
        await expectAccessible(page, `anonymous home (${theme}, ${mode}, ${width}px)`);
        await expectSearchAccessible(page, "status", width, `anonymous home (${theme}, ${mode}, ${width}px)`);
        expect(csp).toEqual([]);
        if (width === 320) expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
      }
    }
  }

  await searchField(page).fill("uptime");
  await expect(results(page)).toHaveText([/Status page/]);
  await searchField(page).fill("mail");
  await expect(results(page)).toHaveCount(0);
  await expect(page.getByText("No link matches mail")).toBeVisible();
  await searchField(page).press("Escape");

  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("a link card opens its service in the same tab", async ({ page }) => {
  setInstanceTheme("default");
  await page.route("https://*.example.invalid/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Service</title><p>Service</p>" }),
  );
  let opened = 0;
  page.on("popup", () => {
    opened += 1;
  });
  await page.goto("/");
  const card = page.getByRole("link", { name: "Status page" });
  await expect(card).not.toHaveAttribute("target");
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("https://status.example.invalid/");
  expect(opened).toBe(0);
});

test.describe("search", () => {
  test.beforeEach(async ({ page }) => {
    setInstanceTheme("default");
    await page.route("https://*.example.invalid/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Service</title><p>Service</p>" }),
    );
    await signIn(page);
  });

  for (const shortcut of ["/", "ControlOrMeta+K"]) {
    test(`opens a result with the keyboard from ${shortcut}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "My links", level: 1 })).toBeVisible();
      await page.keyboard.press(shortcut);
      const field = searchField(page);
      await expect(field).toBeFocused();
      await expect(field).toHaveValue("");
      await page.keyboard.type("cour");
      const mail = results(page).and(page.getByRole("option", { name: /^Mail, Everyday/ }));
      await expect(mail).toHaveAttribute("aria-selected", "true");
      await expect(field).toHaveAttribute("aria-activedescendant", (await mail.getAttribute("id"))!);
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowUp");
      await expect(mail).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL("https://mail.example.invalid/");
    });
  }

  test("never finds a link the person may not see", async ({ page }) => {
    const body = await (await page.request.get("/api/home")).text();
    for (const marker of [...HIDDEN_LINKS, HIDDEN_KEYWORD]) expect(body).not.toContain(marker);
    expect(body).toContain("courrier");

    for (const path of ["/", "/admin/users"]) {
      await page.goto(path);
      await expect(page.getByRole("button", { name: `Account menu for ${ADMIN.name}` })).toBeVisible();
      await page.keyboard.press("/");
      const field = searchField(page);
      for (const query of ["secret", "kw-hidden", "vault", "retired"]) {
        await field.fill(query);
        await expect(page.getByText(`No link matches ${query}`)).toBeVisible();
        await expect(results(page)).toHaveCount(0);
        await expect(page.getByRole("status").filter({ hasText: "No results" })).toHaveCount(1);
      }
      await field.fill("plans");
      await expect(results(page)).toHaveCount(0);
    }
  });

  test("ignores accents and finds hyphenated words joined", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("/");
    const field = searchField(page);
    for (const query of ["equipe", "elearning", "e-learning"]) {
      await field.fill(query);
      await expect(results(page)).toHaveText([/Équipe e-learning/]);
    }
    await field.fill("equipe");
    await expect(results(page).locator("mark")).toHaveText("Équipe");
  });

  test("gives the focus back on Escape, and announces the count", async ({ page }) => {
    await page.goto("/");
    const card = page.getByRole("link", { name: "Status page" });
    await card.focus();
    await page.keyboard.press("/");
    await page.keyboard.type("wiki");
    const status = page.getByRole("banner").getByRole("status");
    await expect(status).toHaveText("1 result");
    await page.keyboard.press("Escape");
    await expect(card).toBeFocused();
    await expect(searchField(page)).toHaveValue("");
    await expect(status).toHaveText("");
  });

  test("leaves '/' and Ctrl+K alone in other fields", async ({ page }) => {
    await page.goto("/admin/users/new");
    await page.getByRole("button", { name: "Next" }).click();
    const name = page.getByLabel("Name", { exact: true });
    await name.focus();
    await page.keyboard.type("a/b");
    await page.keyboard.press("ControlOrMeta+K");
    await expect(name).toBeFocused();
    await expect(name).toHaveValue("a/b");
  });

  test("works on a 320 px screen without widening the page", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    for (const path of ["/", "/admin/users"]) {
      await page.goto(path);
      const toggle = page.getByRole("button", { name: "Search", exact: true });
      const trigger = page.getByRole("button", { name: `Account menu for ${ADMIN.name}` });
      // The search row opens under the first row: the toggle and the account menu stay where they were.
      const firstRow = async () => [(await toggle.boundingBox())!.y, (await trigger.boundingBox())!.y];
      const before = await firstRow();
      await expect(searchField(page)).toBeHidden();
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(searchField(page)).toBeFocused();
      await page.keyboard.type("m");
      await expect(page.getByRole("listbox")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
      expect(await firstRow()).toEqual(before);
      await page.keyboard.press("Escape");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(toggle).toBeFocused();
      await expect(searchField(page)).toBeHidden();
    }
  });
});

test("the server sends the icon files as JSON, cached for good", async ({ request }) => {
  const icon = await request.get(`${ICONS_BASE}/si/github.json`);
  expect(icon.status()).toBe(200);
  expect(icon.headers()["content-type"]).toContain("application/json");
  expect(icon.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
  expect(((await icon.json()) as { path: string }).path).toMatch(/^M/);
  expect((await request.get(`${ICONS_BASE}/si/no_such_brand.json`)).status()).toBe(404);
});

test("the temporary password screen is accessible, with field errors too", async ({ page }) => {
  test.setTimeout(180_000);
  await addTemporaryUser();
  const res = await page.request.post("/api/auth/sign-in/email", { data: TEMPORARY });
  expect(res.ok()).toBe(true);
  for (const theme of THEMES) {
    for (const mode of MODES) {
      for (const width of WIDTHS) {
        const label = `change password (${theme}, ${mode}, ${width}px)`;
        const csp = watchCsp(page);
        await open(page, "/", theme, mode, width);
        await expect(page.getByRole("heading", { name: "Choose your password" })).toBeVisible();
        await expectAccessible(page, label);
        // Errors under every field, with a password shown, without sending anything.
        await page.getByLabel("New password", { exact: true }).fill("short");
        await page.getByRole("button", { name: "Show password" }).nth(1).click();
        await page.getByRole("button", { name: "Save password" }).click();
        await expect(page.getByRole("group", { name: "Check the highlighted fields." })).toBeFocused();
        await expect(page.getByLabel("New password", { exact: true })).toHaveAttribute("aria-invalid", "true");
        await expectAccessible(page, `${label}, field errors`);
        await expectNoHorizontalScroll(page, `${label}, field errors`);
        expect(csp).toEqual([]);
      }
    }
  }

  // Saved after the accessibility loop, which needs the step to stay: the app opens with the heading focused,
  // and the notice is shown and announced.
  await open(page, "/", "default", "light", 1280);
  await page.getByLabel("Temporary password", { exact: true }).fill(TEMPORARY.password);
  await page.getByLabel("New password", { exact: true }).fill("a brand new passphrase");
  await page.getByLabel("Confirm new password", { exact: true }).fill("a brand new passphrase");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "My links" })).toBeFocused();
  await expect(page.getByRole("note")).toHaveText(/Password saved\./);
  await expect(announcer(page)).toHaveText("Password saved.");
  await expectAccessible(page, "home after the temporary password, with the notice");
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
  await expect(searchField(page)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "My links" })).toBeFocused();
  await expect(menu.getByRole("menuitem", { name: "My links" })).toHaveAttribute("aria-current", "page");
  // Language and appearance live on the account page: sign-out comes right after the pages and About.
  for (const name of ["My account", "Administration", "About", "Sign out"]) {
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name })).toBeFocused();
  }
  await expect(menu.getByRole("menuitemradio")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  // The favourites panel comes first; its skip link leads past it to the categories.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Go to the links" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#home-links")).toBeFocused();
  await page.keyboard.press("Tab");
  const card = page.getByRole("link", { name: "Status page" });
  await expect(card).toBeFocused();
  // The focus outline is drawn on the whole card, around the title link.
  expect(await card.evaluate((el) => getComputedStyle(el.closest(".relief")!).outlineStyle)).not.toBe("none");
});

// 320 by 256 CSS pixels is a 1280 by 1024 window at 400 % zoom.
test("the sections and sign-out stay reachable at 400 % zoom, without horizontal scroll", async ({ page }) => {
  setInstanceTheme("default");
  await signIn(page);
  await page.setViewportSize({ width: 320, height: 256 });
  for (const [path, current] of [["/", "My links"], ["/admin/users", "Administration"]] as const) {
    await page.goto(path);
    const trigger = page.getByRole("button", { name: `Account menu for ${ADMIN.name}` });
    await expect(trigger).toBeInViewport();
    await trigger.click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: current })).toHaveAttribute("aria-current", "page");
    for (const name of ["My links", "Administration", "About", "Sign out"]) {
      const item = menu.getByRole("menuitem", { name });
      await item.scrollIntoViewIfNeeded();
      await expect(item).toBeInViewport();
    }
    await expectNoHorizontalScroll(page, `account menu at 400 % zoom on ${path}`);
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: `Account menu for ${ADMIN.name}` }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "My links" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "My links", level: 1 })).toBeFocused();
});

test("the sticky header never hides the focused element", async ({ page }) => {
  setInstanceTheme("default");
  await signIn(page);
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.goto("/");
  await page.getByRole("link", { name: "Status page" }).focus();
  /** Return where the focused element sits against the header, or null when the focus is in the header or gone. */
  const place = () =>
    page.evaluate(() => {
      const focused = document.activeElement;
      if (!focused || focused === document.body || focused.closest("header")) return null;
      return { top: focused.getBoundingClientRect().top, headerBottom: document.querySelector("header")!.getBoundingClientRect().bottom };
    });
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let i = 0; i < 15; i += 1) {
      await page.keyboard.press(key);
      const at = await place();
      if (!at) break;
      expect(at.top).toBeGreaterThanOrEqual(at.headerBottom);
    }
  }
});

test("the language follows the person's choice", async ({ page }) => {
  setInstanceTheme("default");
  await page.goto("/sign-in");
  await page.getByRole("group", { name: "Preferences" }).getByLabel("Language / Langue").selectOption("fr");
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
});
