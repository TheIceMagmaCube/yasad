import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";

import type { Config } from "./config";
import type { AppEnv } from "./context";
import type { DB } from "./db";
import { account, session, user, verification } from "./schema";

export const MIN_PASSWORD = 12;
export const MAX_PASSWORD = 128;

export function createAuth(db: DB, config: Config) {
  return betterAuth({
    appName: "YASAD",
    baseURL: config.publicUrl,
    basePath: "/api/auth",
    secret: config.authSecret,
    trustedOrigins: [new URL(config.publicUrl).origin],
    database: drizzleAdapter(db, { provider: "sqlite", schema: { user, session, account, verification } }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD,
      maxPasswordLength: MAX_PASSWORD,
    },
    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "user", input: false },
        mustChangePassword: { type: "boolean", required: false, defaultValue: false, input: false },
      },
    },
    session: { expiresIn: config.sessionMaxAge },
    databaseHooks: {
      session: {
        create: {
          // A disabled account gets a session the sign-in route deletes at once: not a sign-in.
          after: async ({ userId, createdAt }) => {
            await db
              .update(user)
              .set({ lastSignInAt: createdAt })
              .where(and(eq(user.id, userId), eq(user.disabled, false)));
          },
        },
      },
    },
    rateLimit: { enabled: false },
    advanced: { useSecureCookies: config.publicUrl.startsWith("https://") },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** Return the request's Better Auth instance, creating it on first use. */
export function authFor(c: Context<AppEnv>): Auth {
  let auth = c.get("auth");
  if (!auth) {
    auth = createAuth(c.var.db, c.var.config);
    c.set("auth", auth);
  }
  return auth;
}
