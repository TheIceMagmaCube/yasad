// Screenshot harness for the "Registre" admin prototype: serves frontend/dist, answers the API from mock/api.ts.
// Run from frontend/ after a build: CI=1 npx tsx .shots/registre.ts
import { mkdir, readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

import { chromium, type Page } from "@playwright/test";

import { createMockApi } from "../mock/api";

const HERE = import.meta.dirname;
const OUT = join(HERE, "registre");
const DIST = join(HERE, "..", "dist");
const ORIGIN = "http://yasad.test";
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

async function mock(page: Page, theme: string) {
  const api = createMockApi({ theme });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort();
    if (url.pathname.startsWith("/api/")) {
      const raw = route.request().postData();
      const answer = api.handle(route.request().method(), url.pathname, raw ? JSON.parse(raw) : {});
      if (!answer) return route.fulfill({ status: 404 });
      return route.fulfill({
        status: answer.status,
        contentType: answer.type ?? "application/json",
        body: answer.body === undefined ? "" : typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body),
      });
    }
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, "");
    let file = join(DIST, rel);
    let body: Buffer;
    try {
      body = await readFile(file);
    } catch {
      file = join(DIST, "index.html");
      body = await readFile(file);
    }
    return route.fulfill({ status: 200, contentType: TYPES[extname(file)] ?? "application/octet-stream", body });
  });
}

async function settle(page: Page) {
  await page.locator("h1").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

type Shot = { name: string; path: string; act?: (page: Page) => Promise<void>; full?: boolean };
const next = async (page: Page) => {
  await page.getByRole("button", { name: "Suivant" }).click();
  await page.waitForTimeout(250);
};
const personSteps = async (page: Page, upTo: number) => {
  await next(page);
  if (upTo === 1) return;
  await page.getByLabel("Nom", { exact: true }).fill("Julie Garnier");
  await page.getByLabel("E-mail").fill("julie.garnier@example.invalid");
  await next(page); // role
  await next(page); // groups
  await page.getByLabel("Managers").check();
  if (upTo === 3) return;
  await next(page); // recap
  if (upTo === 4) return;
  await page.getByRole("button", { name: "Créer le compte" }).click();
  await page.waitForTimeout(400);
};
const SHOTS: Shot[] = [
  { name: "admin-dashboard", path: "/admin", full: true },
  {
    name: "user-menu-open",
    path: "/admin/users",
    act: async (page) => {
      await page.getByRole("button", { name: /Menu du compte|Account menu/ }).click();
      await page.waitForTimeout(300);
    },
  },
  { name: "account", path: "/account", full: true },
  { name: "admin-users", path: "/admin/users", full: true },
  {
    name: "admin-users-group",
    path: "/admin/users",
    full: true,
    act: async (page) => {
      await page.locator("#users-group").selectOption("g-mgr");
      await page.waitForTimeout(250);
    },
  },
  { name: "admin-users-new-type", path: "/admin/users/new", full: true },
  { name: "admin-users-new-identity", path: "/admin/users/new", full: true, act: (page) => personSteps(page, 1) },
  { name: "admin-users-new-groups", path: "/admin/users/new", full: true, act: (page) => personSteps(page, 3) },
  { name: "admin-users-new-recap", path: "/admin/users/new", full: true, act: (page) => personSteps(page, 4) },
  { name: "admin-users-new-password", path: "/admin/users/new", full: true, act: (page) => personSteps(page, 5) },
  { name: "admin-groups-detail", path: "/admin/groups/g-mgr", full: true },
  {
    name: "admin-groups-new",
    path: "/admin/users/new?type=group",
    full: true,
    act: async (page) => {
      await next(page);
      await page.getByRole("textbox", { name: "Nom" }).fill("Support N2");
      await next(page);
    },
  },
  { name: "admin-links", path: "/admin/links", full: true },
  {
    name: "admin-links-reorder-categories",
    path: "/admin/links",
    full: true,
    act: async (page) => {
      await page.locator("#links-reorder").click();
      await page.waitForTimeout(250);
    },
  },
  {
    name: "admin-links-reorder-links",
    path: "/admin/links",
    full: true,
    act: async (page) => {
      await page.locator("#links-reorder").click();
      await page.getByRole("button", { name: "Liens", exact: true }).click();
      await page.waitForTimeout(250);
    },
  },
  { name: "admin-links-detail", path: "/admin/links/jira", full: true },
  { name: "admin-links-new-type", path: "/admin/links/new", full: true },
  {
    name: "admin-links-new-groups",
    path: "/admin/links/new",
    full: true,
    act: async (page) => {
      await next(page);
      await page.getByRole("textbox", { name: "Adresse" }).fill("https://status.example.invalid");
      await page.getByRole("textbox", { name: "Titre" }).fill("Status");
      await next(page);
      await next(page);
    },
  },
];

const only = process.argv[2];
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "msedge" });
const runs = [
  { theme: "default", mode: "light", width: 1280, height: 800 },
  { theme: "default", mode: "dark", width: 1280, height: 800 },
  { theme: "default", mode: "light", width: 390, height: 844 },
  { theme: "default", mode: "dark", width: 390, height: 844 },
  { theme: "dusk", mode: "light", width: 1280, height: 800 },
].filter((run) => !only || `${run.theme}-${run.mode}-${run.width}` === only);
for (const run of runs) {
  const context = await browser.newContext({ viewport: { width: run.width, height: run.height }, colorScheme: run.mode as "dark" | "light", deviceScaleFactor: 1 });
  await context.addInitScript(
    ([t, m]) => {
      localStorage.setItem("yasad.instanceTheme", t);
      localStorage.setItem("yasad.mode", m);
      localStorage.setItem("yasad.language", "fr");
    },
    [run.theme, run.mode],
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  page.on("console", (msg) => msg.type() === "error" && console.log("console", msg.text()));
  await mock(page, run.theme);
  for (const shot of SHOTS) {
    await page.goto(ORIGIN + shot.path);
    await settle(page);
    try {
      await shot.act?.(page);
    } catch (e) {
      console.log(`act failed ${shot.name} ${run.theme}-${run.mode}-${run.width}:`, (e as Error).message.split("\n")[0]);
    }
    const file = join(OUT, `${shot.name}-${run.theme}-${run.mode}-${run.width}.png`);
    await page.screenshot({ path: file, fullPage: shot.full ?? false });
  }
  await context.close();
}
await browser.close();
console.log("done");
