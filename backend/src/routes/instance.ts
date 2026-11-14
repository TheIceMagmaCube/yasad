import { inArray } from "drizzle-orm";
import { Hono } from "hono";

import type { AppEnv } from "../context";
import type { DB } from "../db";
import { imageIdOf } from "../images/store";
import { setting } from "../schema";
import { knownTheme } from "../themes";

const DEFAULT_TITLE = "YASAD";

/** The instance settings the admin sets, by field, as keys of the `setting` table. */
export const INSTANCE_KEYS = { title: "instance.title", logo: "instance.logo", theme: "instance.theme" } as const;

/**
 * Return the logo's address when the CSP lets the page show it, otherwise null: a stored image, or a value set
 * outside the app (same-origin path or data:image URI).
 */
export function displayableLogo(value: string | undefined): string | null {
  if (!value) return null;
  const id = imageIdOf(value);
  if (id) return `/api/images/${id}`;
  if (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")) return value;
  if (value.startsWith("data:image/")) return value;
  return null;
}

/** Return the stored instance settings, by key. */
export async function instanceSettings(db: DB): Promise<Map<string, string>> {
  const rows = await db
    .select({ key: setting.key, value: setting.value })
    .from(setting)
    .where(inArray(setting.key, Object.values(INSTANCE_KEYS)));
  return new Map(rows.map((r) => [r.key, r.value]));
}

export const instance = new Hono<AppEnv>();

instance.get("/", async (c) => {
  const values = await instanceSettings(c.var.db);
  c.header("Cache-Control", "no-store");
  return c.json({
    title: values.get(INSTANCE_KEYS.title)?.trim() || DEFAULT_TITLE,
    logo: displayableLogo(values.get(INSTANCE_KEYS.logo)),
    theme: knownTheme(values.get(INSTANCE_KEYS.theme)),
    defaultLanguage: c.var.config.defaultLanguage,
    passwordSignIn: c.var.config.passwordSignIn,
    oidc: c.var.config.oidc ? { name: c.var.config.oidc.providerName } : null,
  });
});

/**
 * Redirect to the tab icon: the logo, or the YASAD logo of the static files. index.html is static on Workers, so
 * only an address under /api can follow the setting; a data: logo cannot be a redirect target and falls back too.
 */
instance.get("/icon", async (c) => {
  const logo = displayableLogo((await instanceSettings(c.var.db)).get(INSTANCE_KEYS.logo));
  c.header("Cache-Control", "no-cache");
  return c.redirect(logo?.startsWith("/") ? logo : "/favicon.svg", 302);
});
