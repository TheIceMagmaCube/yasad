import { DatabaseSync } from "node:sqlite";

import AxeBuilder from "@axe-core/playwright";
import { hashPassword } from "better-auth/crypto";
import { expect, type Page } from "@playwright/test";

import { E2E_DB } from "../playwright.config";

export const THEMES = ["default", "dusk", "night"] as const;
export const MODES = ["light", "dark"] as const;
export const WIDTHS = [320, 1280] as const;

export const ADMIN = { name: "Ada Lovelace", email: "ada@example.invalid", password: "correct horse battery" };

/** Set the instance theme directly in the database (the first server's unless `file` names another one). */
export function setInstanceTheme(theme: string, file = E2E_DB): void {
  const db = new DatabaseSync(file);
  try {
    db.prepare(
      "insert into setting (key, value) values ('instance.theme', ?) on conflict(key) do update set value = excluded.value, updated_at = unixepoch() * 1000",
    ).run(theme);
  } finally {
    db.close();
  }
}

export const TEMPORARY = { email: "bob@example.invalid", password: "temporary password" };

type LocalUser = { id: string; name: string; email: string; password: string; mustChangePassword?: boolean };

/** Insert a local user with a known password straight into the database. */
export async function addLocalUser({ id, name, email, password, mustChangePassword = false }: LocalUser): Promise<void> {
  const hash = await hashPassword(password);
  const db = new DatabaseSync(E2E_DB);
  try {
    db.prepare(`insert into "user" (id, name, email, must_change_password) values (?, ?, ?, ?)`).run(id, name, email, mustChangePassword ? 1 : 0);
    db.prepare(`insert into account (id, account_id, provider_id, user_id, password) values (?, ?, 'credential', ?, ?)`).run(`acc-${id}`, id, id, hash);
  } finally {
    db.close();
  }
}

/** Insert a user who must replace a temporary password, with a known one. */
export async function addTemporaryUser(): Promise<void> {
  await addLocalUser({ id: "bob", name: "Bob", email: TEMPORARY.email, password: TEMPORARY.password, mustChangePassword: true });
}

/** Collect the CSP violations the page reports, to assert none happened. */
export function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && msg.text().includes("Content Security Policy")) violations.push(msg.text());
  });
  return violations;
}

/** Fail on any WCAG 2.2 A or AA violation found by axe on the current page. */
export async function expectAccessible(page: Page, label: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const summary = violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  expect(summary, label).toEqual([]);
}

/** Open `path` with the instance theme (set in the database `file`), the system colour scheme and the width given. */
export async function open(page: Page, path: string, theme: string, mode: string, width: number, file = E2E_DB): Promise<void> {
  setInstanceTheme(theme, file);
  await page.emulateMedia({ colorScheme: mode as "light" | "dark" });
  await page.setViewportSize({ width, height: 800 });
  await page.goto(path);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
}

/** Sign the page's browser context in as the administrator, through the API. */
export async function signInAsAdmin(page: Page): Promise<void> {
  const res = await page.request.post("/api/auth/sign-in/email", { data: { email: ADMIN.email, password: ADMIN.password } });
  expect(res.ok()).toBe(true);
}

/**
 * Describe the focused element (tag, role, accessible name), or `body` when the focus is lost: comparing it
 * in an assertion shows where the focus went.
 */
export async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return "body";
    const name = el.getAttribute("aria-label") ?? (el as HTMLElement).innerText?.trim().slice(0, 60) ?? "";
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""} "${name}"`;
  });
}

/** Assert that `action` leaves the focus on the element focused before it. */
export async function expectFocusKept(page: Page, action: () => Promise<void>): Promise<void> {
  const before = await focused(page);
  expect(before).not.toBe("body");
  await page.evaluate(() => document.activeElement?.setAttribute("data-focus-probe", ""));
  await action();
  await expect(page.locator("[data-focus-probe]")).toBeFocused();
  await page.evaluate(() => document.querySelector("[data-focus-probe]")?.removeAttribute("data-focus-probe"));
}

/** Fail when the page scrolls sideways at the current width. */
export async function expectNoHorizontalScroll(page: Page, label: string): Promise<void> {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(scroll, `${label}: horizontal scroll`).toBeLessThanOrEqual(width);
}

/** Return the app's announcer region (the one status region read by screen readers). */
export function announcer(page: Page) {
  return page.locator('[data-slot="announcer"]');
}

/** Insert an account with no password, as an OIDC sign-in creates it. */
export function addOidcUser({ id, name, email }: { id: string; name: string; email: string }): void {
  const db = new DatabaseSync(E2E_DB);
  try {
    db.prepare(`insert into "user" (id, name, email) values (?, ?, ?)`).run(id, name, email);
  } finally {
    db.close();
  }
}

/** Insert `n` accounts with no password, named "<prefix> 001" onwards, in one transaction. */
export function addUsers(n: number, prefix: string): void {
  const db = new DatabaseSync(E2E_DB);
  try {
    const insert = db.prepare(`insert into "user" (id, name, email) values (?, ?, ?)`);
    db.exec("begin");
    for (let i = 1; i <= n; i++) {
      const number = String(i).padStart(3, "0");
      const slug = `${prefix.toLowerCase().replace(/\W+/g, "-")}-${number}`;
      insert.run(slug, `${prefix} ${number}`, `${slug}@example.invalid`);
    }
    db.exec("commit");
  } finally {
    db.close();
  }
}

/** Insert a group and its members. */
export function addGroup({ id, name, source = "local", memberIds = [] }: { id: string; name: string; source?: "local" | "oidc"; memberIds?: string[] }): void {
  const db = new DatabaseSync(E2E_DB);
  try {
    db.prepare(`insert into "group" (id, name, source) values (?, ?, ?)`).run(id, name, source);
    for (const userId of memberIds) db.prepare(`insert into user_group (user_id, group_id) values (?, ?)`).run(userId, id);
  } finally {
    db.close();
  }
}
