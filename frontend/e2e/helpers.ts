import { DatabaseSync } from "node:sqlite";

import AxeBuilder from "@axe-core/playwright";
import { hashPassword } from "better-auth/crypto";
import { expect, type Page } from "@playwright/test";

import { E2E_DB } from "../playwright.config";

export const THEMES = ["default", "dusk"] as const;
export const MODES = ["light", "dark"] as const;
export const WIDTHS = [320, 1280] as const;

export const ADMIN = { name: "Ada Lovelace", email: "ada@example.org", password: "correct horse battery" };

/** Set the instance theme directly in the database, as the future admin screen will. */
export function setInstanceTheme(theme: string): void {
  const db = new DatabaseSync(E2E_DB);
  try {
    db.prepare(
      "insert into setting (key, value) values ('instance.theme', ?) on conflict(key) do update set value = excluded.value, updated_at = unixepoch() * 1000",
    ).run(theme);
  } finally {
    db.close();
  }
}

export const TEMPORARY = { email: "bob@example.org", password: "temporary password" };

/** Insert a user who must replace a temporary password, as the admin screen (#8) will. */
export async function addTemporaryUser(): Promise<void> {
  const hash = await hashPassword(TEMPORARY.password);
  const db = new DatabaseSync(E2E_DB);
  try {
    db.prepare(`insert into "user" (id, name, email, must_change_password) values ('bob', 'Bob', ?, 1)`).run(TEMPORARY.email);
    db.prepare(`insert into account (id, account_id, provider_id, user_id, password) values ('acc-bob', 'bob', 'credential', 'bob', ?)`).run(hash);
  } finally {
    db.close();
  }
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
