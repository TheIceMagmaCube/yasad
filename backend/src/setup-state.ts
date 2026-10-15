import { and, eq } from "drizzle-orm";

import type { Config } from "./config";
import type { DB } from "./db";
import { account, user } from "./schema";

export const SETUP_CODE_STILL_SET =
  "SETUP_CODE is still set although an administrator exists. Remove it from the configuration and restart YASAD.";

/** Return whether an admin with a local password account exists. */
export async function hasLocalAdmin(db: DB): Promise<boolean> {
  const row = await db
    .select({ id: user.id })
    .from(user)
    .innerJoin(account, eq(account.userId, user.id))
    .where(and(eq(user.role, "admin"), eq(account.providerId, "credential")))
    .limit(1)
    .get();
  return row !== undefined;
}

/** Return whether setup is open: a setup code is configured and no local admin exists. */
export async function isSetupOpen(db: DB, config: Config): Promise<boolean> {
  return config.setupCode !== null && !(await hasLocalAdmin(db));
}

const encoder = new TextEncoder();

/**
 * Compare two codes in constant time.
 *
 * Both sides are hashed with SHA-256, so the compared values have the same length, then compared without early exit.
 */
export async function codesMatch(given: string, expected: string): Promise<boolean> {
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(s)));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
