import { readFileSync } from "node:fs";

import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

import { ICONS_BASE } from "../src/icons-base";
import { addTemporaryUser, ADMIN, announcer, expectAccessible, expectNoHorizontalScroll, MODES, open, setInstanceTheme, signInAsAdmin, TEMPORARY, THEMES, watchCsp, WIDTHS } from "./helpers";

test.describe.configure({ mode: "serial" });

const signIn = signInAsAdmin;

/** Import a catalog file through the admin API: preview, then apply with the preview's base version. */
async function importCatalog(request: APIRequestContext, path: string): Promise<void> {
  const yaml = readFileSync(path, "utf8");
  const preview = await request.post("/api/admin/catalog", { data: { yaml, dryRun: true } });
  expect(preview.ok(), await preview.text()).toBe(true);
  const { baseVersion } = (await preview.json()) as { baseVersion: string };
  const applied = await request.post("/api/admin/catalog", { data: { yaml, dryRun: false, baseVersion } });
  expect(applied.ok(), await applied.text()).toBe(true);
}

/** Categories of e2e/fixtures/home.yaml, in order, as the admin sees them (the admin holds no local group). */
const HOME_CATEGORIES = ["Public", "Everyday", "Documentation", "People", "Money", "Operations", "Miscellaneous"];
/** Links of the fixture the admin may not see: two on local:Nobody, one inactive. */
const HIDDEN_LINKS = ["Secret plans", "Secret vault", "Retired tool"];
/** Keyword of a hidden link: it must never reach the browser either. */
const HIDDEN_KEYWORD = "kw-hidden-marker";

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
        await signIn(page);
        const csp = watchCsp(page);
        await open(page, "/", theme, mode, width);
        const main = page.getByRole("main");
        await expect(main.getByRole("heading", { level: 2 })).toHaveText(HOME_CATEGORIES);
        for (const title of HIDDEN_LINKS) await expect(main.getByText(title)).toHaveCount(0);
        const body = await (await page.request.get("/api/home")).text();
        for (const title of HIDDEN_LINKS) expect(body).not.toContain(title);

        const everyday = page.getByRole("region", { name: "Everyday" });
        await expect(everyday.getByRole("link", { name: "Mail" }).locator("svg")).toBeVisible();
        await expect(everyday.getByRole("link", { name: "Code" }).locator("svg")).toBeVisible();
        await expect(everyday.getByRole("link", { name: "Chat" }).locator('[data-slot="link-icon"]')).toHaveText("C");
        await expect(everyday.getByRole("link", { name: "Chat" }).locator("svg")).toHaveCount(0);

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

    for (const path of ["/", "/admin/groups"]) {
      await page.goto(path);
      await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
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
    await page.goto("/admin/users");
    await page.getByRole("button", { name: "New user" }).click();
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
      const active = page.getByRole("navigation", { name: "Main" }).locator('[aria-current="page"]');
      const borderAtRowBottom = async () => {
        const box = (await active.boundingBox())!;
        expect(Math.round(box.y + box.height)).toBe(56);
      };
      await borderAtRowBottom();
      await expect(searchField(page)).toBeHidden();
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(searchField(page)).toBeFocused();
      await page.keyboard.type("m");
      await expect(page.getByRole("listbox")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
      await borderAtRowBottom();
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
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const name of ["My links", "Admin"]) {
    await page.keyboard.press("Tab");
    await expect(nav.getByRole("link", { name })).toBeFocused();
  }
  await page.keyboard.press("Tab");
  await expect(searchField(page)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "My account" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Administration" })).toBeFocused();

  for (const name of ["English", "Français", "System", "Light", "Dark"]) {
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitemradio", { name })).toBeFocused();
  }
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.keyboard.press("Tab");
  const card = page.getByRole("link", { name: "Status page" });
  await expect(card).toBeFocused();
  expect(await card.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
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
