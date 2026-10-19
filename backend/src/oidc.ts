import { defineRequestState } from "@better-auth/core/context";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { and, eq, exists, inArray, ne, sql } from "drizzle-orm";

import { sharedOptions } from "./auth";
import type { Config, OidcConfig } from "./config";
import type { DB } from "./db";
import { group, session, user, userGroup } from "./schema";

/** Id of the one OIDC provider, in `account.provider_id` and in the callback path. */
export const OIDC_PROVIDER_ID = "oidc";

/** Codes the sign-in page translates; any other failure reaches it as `sign_in_failed`. */
export const SIGN_IN_ERRORS = new Set([
  "not_allowed",
  "account_not_linked",
  "email_in_use",
  "account_disabled",
  "provider_unavailable",
  "state_mismatch",
  "access_denied",
  "rate_limited",
]);

/** Better Auth codes that mean the provider could not be reached, renamed for the sign-in page. */
const PROVIDER_DOWN_CODES = new Set(["oauth_provider_not_found"]);

/** Return the code the sign-in page receives for a Better Auth or provider error code. */
export function signInErrorCode(code: string | null): string {
  if (code && PROVIDER_DOWN_CODES.has(code)) return "provider_unavailable";
  return code && SIGN_IN_ERRORS.has(code) ? code : "sign_in_failed";
}

/** The fields of the provider's discovery document YASAD relies on. */
export type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  id_token_signing_alg_values_supported: string[];
  end_session_endpoint?: string;
};

const isUrl = (value: unknown): value is string => typeof value === "string" && URL.canParse(value);

/** Return whether `value` is an address YASAD may call or send the browser to: https, or also http when `secure` is false. */
function isEndpoint(value: unknown, secure: boolean): value is string {
  if (!isUrl(value)) return false;
  const { protocol } = new URL(value);
  return protocol === "https:" || (!secure && protocol === "http:");
}

/**
 * Read the provider's discovery document, or return null when it is unreachable, slow or unusable.
 *
 * With an https PUBLIC_URL every endpoint must be https too, so the client secret, the code and the
 * signing keys never travel in clear; http is accepted otherwise, for a local setup. An end-session
 * endpoint that fails this check is dropped rather than refusing the document.
 */
export async function readDiscovery(url: string, publicUrl: string, timeoutMs: number): Promise<Discovery | null> {
  const secure = publicUrl.startsWith("https://");
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const doc = (await res.json()) as Record<string, unknown>;
    const algs = doc.id_token_signing_alg_values_supported;
    if (!isUrl(doc.issuer)) return null;
    if (![doc.authorization_endpoint, doc.token_endpoint, doc.jwks_uri].every((endpoint) => isEndpoint(endpoint, secure))) return null;
    if (!Array.isArray(algs) || algs.length === 0 || !algs.every((a) => typeof a === "string")) return null;
    const { end_session_endpoint: endSession, ...rest } = doc;
    return { ...rest, ...(isEndpoint(endSession, secure) ? { end_session_endpoint: endSession } : {}) } as Discovery;
  } catch {
    return null;
  }
}

/** What the session hook needs from the verified ID token. */
type SignInClaims = { groups: string[]; emailVerified: unknown };

/**
 * Claims of the sign-in being handled, set by getUserInfo and read by the hooks of the same request.
 *
 * Null outside the provider's callback, so the hooks do nothing for any other session.
 */
const signInClaims = defineRequestState<SignInClaims | null>(() => null);

async function currentClaims(): Promise<SignInClaims | null> {
  try {
    return await signInClaims.get();
  } catch {
    return null;
  }
}

/** Return the group names of a claim: a list or a single string, trimmed, without empty values or duplicates. */
export function groupNames(claim: unknown): string[] {
  const values = Array.isArray(claim) ? claim : [claim];
  return [...new Set(values.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean))];
}

/** Return the payload of a JWT already verified by Better Auth, or null. */
function jwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")), (ch) => ch.charCodeAt(0));
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const isAdmin = (oidc: OidcConfig, groups: string[]) => groups.some((g) => oidc.adminGroups.includes(g));

/** Return the refusal code for these claims, or null when the person may sign in. */
function refusal(oidc: OidcConfig, claims: SignInClaims): string | null {
  // An unverified address could take over the one of another account.
  if (claims.emailVerified === false) return "not_allowed";
  if (oidc.allowedGroups.length === 0 || isAdmin(oidc, claims.groups)) return null;
  return claims.groups.some((g) => oidc.allowedGroups.includes(g)) ? null : "not_allowed";
}

/**
 * Write the person's OIDC groups and role from the token, in one batch.
 *
 * Each group of the token is stamped as seen, so the admin screens can tell a group the provider
 * sent from one only typed in the catalog.
 *
 * Every statement binds the group list as a single JSON parameter, so a long list stays under D1's
 * limit on bound parameters. Local groups are left alone. The role is written over
 * `role_override`, so an override set while the person signs in is kept.
 */
async function writeGroupsAndRole(db: DB, oidc: OidcConfig, userId: string, groups: string[]) {
  const names = JSON.stringify(groups);
  const created = JSON.stringify(groups.map((name) => ({ id: crypto.randomUUID(), name })));
  const role = isAdmin(oidc, groups) ? "admin" : "user";
  const oidcGroupIds = db.select({ id: group.id }).from(group).where(eq(group.source, "oidc"));
  const tokenNames = db.select({ name: sql<string>`value` }).from(sql`json_each(${names})`);
  await db.batch([
    db
      .insert(group)
      .select(
        db
          .select({
            id: sql<string>`json_extract(value, '$.id')`.as("id"),
            name: sql<string>`json_extract(value, '$.name')`.as("name"),
            source: sql<"oidc">`'oidc'`.as("source"),
            createdAt: sql<Date>`unixepoch() * 1000`.as("created_at"),
            seenAt: sql<Date>`unixepoch() * 1000`.as("seen_at"),
          })
          .from(sql`json_each(${created})`)
          // SQLite needs a WHERE clause to tell an upsert from a join on an INSERT ... SELECT.
          .where(sql`true`),
      )
      .onConflictDoNothing({ target: [group.source, group.name] }),
    // The insert above skips the groups that already exist.
    db
      .update(group)
      .set({ seenAt: sql`unixepoch() * 1000` })
      .where(and(eq(group.source, "oidc"), inArray(group.name, tokenNames))),
    db.delete(userGroup).where(and(eq(userGroup.userId, userId), inArray(userGroup.groupId, oidcGroupIds))),
    db
      .insert(userGroup)
      .select(
        db
          .select({ userId: sql<string>`${userId}`.as("user_id"), groupId: group.id })
          .from(group)
          .where(and(eq(group.source, "oidc"), inArray(group.name, tokenNames))),
      )
      .onConflictDoNothing(),
    db
      .update(user)
      .set({ role: sql`coalesce(${user.roleOverride}, ${role})`, updatedAt: new Date() })
      .where(eq(user.id, userId)),
  ]);
}

const failed = () => new APIError("INTERNAL_SERVER_ERROR", { code: "sign_in_failed", message: "Signing in failed." });
const disabled = () => new APIError("FORBIDDEN", { code: "account_disabled", message: "This account is disabled." });

/**
 * Return a Better Auth instance that signs in through the OIDC provider.
 *
 * Built only for the start and the callback of a provider sign-in: starting it reads the discovery
 * document, which no other request should wait on. It shares the options of the common instance, so
 * the session it creates is read by `sessionFor` like any other. The authorization and token
 * endpoints are the ones of YASAD's own read, already checked.
 */
function createOidcAuth(db: DB, config: Config & { oidc: OidcConfig }, discovery: Discovery) {
  const { oidc } = config;
  const shared = sharedOptions(db, config);
  return betterAuth({
    ...shared,
    onAPIError: { errorURL: `${config.publicUrl}/sign-in` },
    account: {
      storeStateStrategy: "database",
      // A provider account never takes over an account that already uses its e-mail.
      accountLinking: { disableImplicitLinking: true },
    },
    user: {
      ...shared.user,
      validateUserInfo: async ({ user: incoming, source }) => {
        if (source.oauth?.providerId !== OIDC_PROVIDER_ID) return;
        const claims = await currentClaims();
        if (!claims) return { error: "sign_in_failed" };
        const refused = refusal(oidc, claims);
        if (refused) return { error: refused };
        if (source.action === "sign-in" && typeof incoming.id === "string") {
          // Refused here, before Better Auth rewrites the account's tokens and profile; the session
          // hooks check again for an account disabled while the sign-in runs.
          const row = await db.select({ disabled: user.disabled }).from(user).where(eq(user.id, incoming.id)).get();
          if (row?.disabled) return { error: "account_disabled" };
        }
        if (source.action === "sign-in" && typeof incoming.id === "string" && typeof incoming.email === "string") {
          // Checked before the profile write, not inside it: an address another account takes in
          // between fails on the unique index, and the person gets sign_in_failed; a retry then
          // gets email_in_use.
          const other = await db
            .select({ id: user.id })
            .from(user)
            .where(and(eq(user.email, incoming.email), ne(user.id, incoming.id)))
            .get();
          if (other) return { error: "email_in_use" };
        }
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async ({ userId }) => {
            const claims = await currentClaims();
            if (!claims) return;
            const row = await db.select({ disabled: user.disabled }).from(user).where(eq(user.id, userId)).get();
            // A successful sign-in at the provider is a right password: the account can be told disabled.
            if (row?.disabled) throw disabled();
            try {
              await writeGroupsAndRole(db, oidc, userId, claims.groups);
            } catch (err) {
              console.error(err);
              throw failed();
            }
          },
          after: async (created) => {
            await shared.databaseHooks.session.create.after(created);
            if (!(await currentClaims())) return;
            // An admin may disable the account between the check above and the session insert.
            const removed = await db
              .delete(session)
              .where(
                and(
                  eq(session.id, created.id),
                  exists(db.select({ id: user.id }).from(user).where(and(eq(user.id, created.userId), eq(user.disabled, true)))),
                ),
              )
              .returning({ id: session.id });
            if (removed.length > 0) throw disabled();
          },
        },
      },
    },
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: OIDC_PROVIDER_ID,
            name: oidc.providerName,
            discoveryUrl: oidc.discoveryUrl,
            authorizationUrl: discovery.authorization_endpoint,
            tokenUrl: discovery.token_endpoint,
            clientId: oidc.clientId,
            clientSecret: oidc.clientSecret,
            scopes: oidc.scopes,
            pkce: true,
            responseMode: "query",
            requireIdTokenVerification: true,
            overrideUserInfo: true,
            // The issuer is part of the identity: a new provider never takes over the accounts of the old one.
            accountSubject: ({ profile }) => `${String(profile.iss ?? "")}|${String(profile.sub ?? "")}`,
            // Called once Better Auth verified the ID token (signature, issuer, audience, nonce); the
            // userinfo endpoint is never read, so groups only come from the verified token.
            getUserInfo: async (tokens) => {
              if (!tokens.idToken) return null;
              const claims = jwtPayload(tokens.idToken);
              if (!claims || typeof claims.sub !== "string" || !claims.sub || typeof claims.iss !== "string") return null;
              const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
              const name = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : email;
              await signInClaims.set({ groups: groupNames(claims[oidc.groupsClaim]), emailVerified: claims.email_verified });
              return { id: claims.sub, sub: claims.sub, iss: claims.iss, email, emailVerified: claims.email_verified === true, name };
            },
          },
        ],
      }),
    ],
  });
}

/**
 * Return the OIDC instance for a start or a callback, or null when the provider cannot be used.
 *
 * YASAD reads the discovery document first, bounded by `timeoutMs` and checked by `readDiscovery`.
 * The instance then reads it a second time, without a time limit, to build the provider: the issuer,
 * the JWKS address and the signing algorithms come from that second read. The provider it built must
 * have the issuer of the first read and a list of signing algorithms, since without one Better Auth
 * accepts whatever algorithm the token header names. Callers bound the whole call in time.
 */
export async function oidcAuth(db: DB, config: Config & { oidc: OidcConfig }, timeoutMs: number) {
  const discovery = await readDiscovery(config.oidc.discoveryUrl, config.publicUrl, timeoutMs);
  if (!discovery) return null;
  const auth = createOidcAuth(db, config, discovery);
  const provider = (await auth.$context).socialProviders.find((p) => p.id === OIDC_PROVIDER_ID);
  const idToken = provider?.idToken;
  const algorithms = idToken && "algorithms" in idToken ? idToken.algorithms : undefined;
  if (provider?.issuer !== discovery.issuer || !algorithms?.length) return null;
  return auth;
}
