import { expect, type Page, type Route, test } from "@playwright/test";

import { FAKE_OIDC_URL, OIDC_BASE_URL, OIDC_CLIENT, OIDC_E2E_DB, OIDC_PROVIDER_NAME } from "../playwright.config";
import { expectAccessible, expectNoHorizontalScroll, MODES, open, setInstanceTheme, THEMES, watchCsp, WIDTHS } from "./helpers";

// Every test drives the one fake provider, so they run one after the other.
test.describe.configure({ mode: "serial" });

type Claims = { sub: string; email: string; name: string; email_verified?: boolean; groups?: string[] };

const ALICE: Claims = { sub: "alice", email: "alice@example.invalid", email_verified: true, name: "Alice Martin", groups: ["portal-users"] };
const BOB: Claims = { sub: "bob", email: "bob@example.invalid", email_verified: true, name: "Bob Durand", groups: ["contractors"] };

const PROVIDER_BUTTON = `Sign in with ${OIDC_PROVIDER_NAME}`;
const LOCAL_LINK = "Administrator? Sign in with a password";
const NOT_ALLOWED = "Your account does not have access to this portal.";

async function control(method: string, path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${FAKE_OIDC_URL}/__control/${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.ok, `${method} /__control/${path}`).toBe(true);
  return res;
}

/** Forget what the provider received, and make `claims` the person signed in at the provider. */
async function signedInAtProvider(claims: Claims): Promise<void> {
  await control("POST", "reset");
  await control("PUT", "user", claims);
}

/** Return the addresses the provider received on `path`, oldest first. */
async function providerCalls(path: string): Promise<URL[]> {
  const requests = (await (await control("GET", "requests")).json()) as { url: string }[];
  return requests.map((r) => new URL(r.url)).filter((url) => url.pathname === path);
}

/** Return the signed-in person of the page's browser, or null. */
async function sessionUser(page: Page): Promise<{ name: string } | null> {
  const res = await page.request.get("/api/auth/get-session");
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { user: { name: string } } | null;
  return body?.user ?? null;
}

test.beforeEach(() => setInstanceTheme("default", OIDC_E2E_DB));

test("opening / signs in at the provider by itself and lands on the home its groups allow", async ({ page }) => {
  const csp = watchCsp(page);
  await signedInAtProvider(ALICE);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "My links", level: 1 })).toBeVisible();
  await expect(page).toHaveURL(`${OIDC_BASE_URL}/`);
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: "Mail" })).toBeVisible();
  await expect(main.getByText("Payroll")).toHaveCount(0);
  await expect(main.getByText("Finance")).toHaveCount(0);

  const [authorize] = await providerCalls("/authorize");
  expect(authorize?.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authorize?.searchParams.get("redirect_uri")).toBe(`${OIDC_BASE_URL}/api/auth/callback/oidc`);
  expect(await providerCalls("/authorize")).toHaveLength(1);
  expect((await sessionUser(page))?.name).toBe(ALICE.name);
  expect(csp).toEqual([]);
});

test("a deep link survives the sign-in at the provider", async ({ page }) => {
  const csp = watchCsp(page);
  await signedInAtProvider(ALICE);
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: ALICE.name, level: 1 })).toBeVisible();
  await expect(page).toHaveURL(`${OIDC_BASE_URL}/account`);
  expect(csp).toEqual([]);
});

test("signing out ends the provider session and stays on the signed-out page", async ({ page }) => {
  const csp = watchCsp(page);
  await signedInAtProvider(ALICE);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "My links", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: `Account menu for ${ALICE.name}` }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "You are signed out", level: 1 })).toBeVisible();
  await expect(page).toHaveURL(`${OIDC_BASE_URL}/signed-out`);

  const [endSession] = await providerCalls("/end-session");
  expect(endSession?.searchParams.get("id_token_hint")).toBeTruthy();
  expect(endSession?.searchParams.get("post_logout_redirect_uri")).toBe(`${OIDC_BASE_URL}/signed-out`);
  expect(endSession?.searchParams.get("client_id")).toBe(OIDC_CLIENT.id);

  // The provider here signs anyone in without asking: a sign-in started by the page would show at once.
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(`${OIDC_BASE_URL}/signed-out`);
  expect(await providerCalls("/authorize")).toHaveLength(1);
  expect(await sessionUser(page)).toBeNull();
  await expect(page.getByRole("link", { name: LOCAL_LINK })).toBeVisible();

  await page.getByRole("button", { name: PROVIDER_BUTTON }).click();
  await expect(page.getByRole("heading", { name: "My links", level: 1 })).toBeVisible();
  await expect(page).toHaveURL(`${OIDC_BASE_URL}/`);
  expect(csp).toEqual([]);
});

test("a refused sign-in shows why, once, without going back to the provider", async ({ page }) => {
  const csp = watchCsp(page);
  await signedInAtProvider(BOB);
  await page.goto("/");
  const alert = page.getByRole("group", { name: NOT_ALLOWED });
  await expect(alert).toHaveText(NOT_ALLOWED);
  await expect(alert).toBeFocused();
  await expect(page).toHaveURL(`${OIDC_BASE_URL}/sign-in`);

  await page.waitForLoadState("networkidle");
  expect(await providerCalls("/authorize")).toHaveLength(1);
  expect(await sessionUser(page)).toBeNull();
  await expect(page.getByRole("button", { name: PROVIDER_BUTTON })).toBeVisible();
  await expect(page.getByRole("link", { name: LOCAL_LINK })).toBeVisible();

  // A reload no longer carries the error: the sign-in starts again, and is refused again, once.
  await page.reload();
  await expect(page.getByRole("group", { name: NOT_ALLOWED })).toBeFocused();
  await page.waitForLoadState("networkidle");
  expect(await providerCalls("/authorize")).toHaveLength(2);
  expect(csp).toEqual([]);
});

const PROVIDER_GROUPS = "Identity provider groups (1)";

test("the account page shows the provider groups and when they are read again", async ({ page }) => {
  const csp = watchCsp(page);
  await signedInAtProvider(ALICE);
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: ALICE.name, level: 1 })).toBeVisible();
  await expect(page.getByRole("list", { name: PROVIDER_GROUPS })).toContainText("portal-users");
  await expect(page.getByText("They are read again at your next sign-in.")).toBeVisible();
  await expect(page.getByRole("listitem", { name: "Password" })).toHaveCount(0);
  expect(csp).toEqual([]);
});

test("the account page of a provider account is accessible in every theme, mode and width", async ({ page }) => {
  test.setTimeout(120_000);
  await signedInAtProvider(ALICE);
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: ALICE.name, level: 1 })).toBeVisible();
  for (const theme of THEMES) {
    for (const mode of MODES) {
      for (const width of WIDTHS) {
        const label = `account, provider (${theme}, ${mode}, ${width}px)`;
        const csp = watchCsp(page);
        await open(page, "/account", theme, mode, width, OIDC_E2E_DB);
        await expect(page.getByRole("list", { name: PROVIDER_GROUPS })).toBeVisible();
        await expectAccessible(page, label);
        await expectNoHorizontalScroll(page, label);
        expect(csp).toEqual([]);
      }
    }
  }
});

test("a very long provider group name fits a 320 px screen", async ({ page }) => {
  const long = "g".repeat(120);
  await signedInAtProvider({ ...ALICE, groups: ["portal-users", long] });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/account");
  await expect(page.getByRole("list", { name: "Identity provider groups (2)" }).getByText(long)).toBeVisible();
  await expectNoHorizontalScroll(page, "account, long provider group");
});

for (const theme of THEMES) {
  for (const mode of MODES) {
    for (const width of WIDTHS) {
      test(`provider sign-in screens are accessible (${theme}, ${mode}, ${width}px)`, async ({ page }) => {
        const csp = watchCsp(page);
        await control("POST", "reset");

        // Hold the start of the sign-in to look at the screen shown while it runs; it never reaches the server.
        const held: Route[] = [];
        await page.route("**/api/auth/sign-in/social", (route) => void held.push(route));
        await open(page, "/", theme, mode, width, OIDC_E2E_DB);
        await expect(page.getByRole("status").filter({ hasText: `Redirecting to ${OIDC_PROVIDER_NAME}…` })).toBeVisible();
        await expect(page.getByRole("link", { name: LOCAL_LINK })).toBeVisible();
        await expectAccessible(page, "sign-in, redirecting");
        await expectNoHorizontalScroll(page, "sign-in, redirecting");
        await Promise.all(held.map((route) => route.abort()));
        await page.unrouteAll();

        await open(page, "/sign-in?error=not_allowed", theme, mode, width, OIDC_E2E_DB);
        await expect(page.getByRole("group", { name: NOT_ALLOWED })).toBeFocused();
        await expect(page.getByRole("button", { name: PROVIDER_BUTTON })).toBeVisible();
        await expectAccessible(page, "sign-in, refused");
        await expectNoHorizontalScroll(page, "sign-in, refused");

        await open(page, "/sign-in/local", theme, mode, width, OIDC_E2E_DB);
        await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
        await expectAccessible(page, "sign-in, local");
        await expectNoHorizontalScroll(page, "sign-in, local");

        await open(page, "/signed-out", theme, mode, width, OIDC_E2E_DB);
        await expect(page.getByRole("heading", { name: "You are signed out", level: 1 })).toBeVisible();
        await expectAccessible(page, "signed out");
        await expectNoHorizontalScroll(page, "signed out");

        expect(await providerCalls("/authorize")).toHaveLength(0);
        expect(csp).toEqual([]);
      });
    }
  }
}
