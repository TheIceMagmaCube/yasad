import { inArray } from "drizzle-orm";
import { Hono } from "hono";

import type { AppEnv } from "../context";
import { setting } from "../schema";
import { knownTheme } from "../themes";

const DEFAULT_TITLE = "YASAD";

/** Return the logo when the CSP lets the page show it (same-origin path or data:image URI), otherwise null. */
export function displayableLogo(value: string | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")) return value;
  if (value.startsWith("data:image/")) return value;
  return null;
}

export const instance = new Hono<AppEnv>();

instance.get("/", async (c) => {
  const rows = await c.var.db
    .select({ key: setting.key, value: setting.value })
    .from(setting)
    .where(inArray(setting.key, ["instance.title", "instance.logo", "instance.theme"]));
  const values = new Map(rows.map((r) => [r.key, r.value]));
  c.header("Cache-Control", "no-store");
  return c.json({
    title: values.get("instance.title")?.trim() || DEFAULT_TITLE,
    logo: displayableLogo(values.get("instance.logo")),
    theme: knownTheme(values.get("instance.theme")),
    defaultLanguage: c.var.config.defaultLanguage,
  });
});
