export type RawConfig = Record<string, string | undefined>;

export type Config = {
  authSecret: string;
  publicUrl: string;
  setupCode: string | null;
  trustProxy: number;
  sessionMaxAge: number;
  /** Days an audit log entry is kept, 30 to 3650. */
  auditRetentionDays: number;
  defaultLanguage: Language;
  passwordSignIn: boolean;
  /** Path of the catalog file applied at startup (Docker only), or null. */
  catalogFile: string | null;
  /** Sign-in through an OpenID Connect provider, or null when it is not configured. */
  oidc: OidcConfig | null;
  statusChecks: StatusCheckConfig;
};

export type StatusCheckConfig = {
  /** Minutes between two checks of a link, 1 to 1440. */
  intervalMinutes: number;
  /** Deadline of one whole check, DNS included, 2 to 30 s. */
  timeoutSeconds: number;
  /** Links claimed per batch, 1 to 200 (Workers Free: the budget caps it at 15). */
  batch: number;
  /** Checks in flight at once, 1 to 6. */
  concurrency: number;
};

export type OidcConfig = {
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
  /** Label of the sign-in button. */
  providerName: string;
  /** ID token claim holding the person's groups. */
  groupsClaim: string;
  /** Groups allowed to sign in; empty, anyone the provider accepts may. */
  allowedGroups: string[];
  /** Groups that make their members admins. */
  adminGroups: string[];
  scopes: string[];
};

export const LANGUAGES = ["en", "fr"] as const;
export type Language = (typeof LANGUAGES)[number];

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n- ${problems.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

export const MIN_AUTH_SECRET = 32;
export const MIN_SETUP_CODE = 24;
const DEFAULT_SESSION_MAX_AGE = 60 * 60 * 24;
const DEFAULT_AUDIT_RETENTION_DAYS = 365;
// The floor matches the audit log's delete trigger, which keeps any entry younger than 30 days.
export const MIN_AUDIT_RETENTION_DAYS = 30;
export const MAX_AUDIT_RETENTION_DAYS = 3650;
/** Prefix of the values in .env.example and .dev.vars.example. */
const EXAMPLE_PREFIX = "dev-only-";
export const STATUS_CHECK_LIMITS = {
  intervalMinutes: { min: 1, max: 1440, default: 5 },
  timeoutSeconds: { min: 2, max: 30, default: 10 },
  batch: { min: 1, max: 200, default: 10 },
  concurrency: { min: 1, max: 6, default: 4 },
} as const;
/** Longest a batch may last: ceil(batch / concurrency) × timeoutSeconds must not exceed it. */
export const MAX_RUN_SECONDS = 600;
const OIDC_REQUIRED = ["OIDC_DISCOVERY_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"] as const;

/** Return the comma-separated values, trimmed, without empty ones or duplicates. */
function list(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((v) => v.trim()).filter(Boolean))];
}

type Limits = { readonly min: number; readonly max: number; readonly default: number };

/** Return a whole number within `limits`, the default when unset, or null (with a problem) when invalid. */
function wholeInRange(raw: string | undefined, name: string, limits: Limits, unit: string, problems: string[]): number | null {
  const value = raw?.trim();
  if (!value) return limits.default;
  const n = Number(value);
  if (/^\d+$/.test(value) && n >= limits.min && n <= limits.max) return n;
  problems.push(`${name} must be a whole number${unit} from ${limits.min} to ${limits.max}.`);
  return null;
}

/** Return the status check settings, or null when one of them is invalid. */
function loadStatusChecks(raw: RawConfig, problems: string[]): StatusCheckConfig | null {
  const l = STATUS_CHECK_LIMITS;
  const intervalMinutes = wholeInRange(raw.STATUS_CHECK_INTERVAL_MINUTES, "STATUS_CHECK_INTERVAL_MINUTES", l.intervalMinutes, " of minutes", problems);
  const timeoutSeconds = wholeInRange(raw.STATUS_CHECK_TIMEOUT_SECONDS, "STATUS_CHECK_TIMEOUT_SECONDS", l.timeoutSeconds, " of seconds", problems);
  const batch = wholeInRange(raw.STATUS_CHECK_BATCH, "STATUS_CHECK_BATCH", l.batch, "", problems);
  const concurrency = wholeInRange(raw.STATUS_CHECK_CONCURRENCY, "STATUS_CHECK_CONCURRENCY", l.concurrency, "", problems);
  if (timeoutSeconds === null || batch === null || concurrency === null) return null;
  const seconds = Math.ceil(batch / concurrency) * timeoutSeconds;
  if (seconds > MAX_RUN_SECONDS) {
    problems.push(
      `STATUS_CHECK_BATCH, STATUS_CHECK_CONCURRENCY and STATUS_CHECK_TIMEOUT_SECONDS give a batch of up to ${seconds} s (ceil(BATCH / CONCURRENCY) × TIMEOUT); keep it at most ${MAX_RUN_SECONDS} s.`,
    );
    return null;
  }
  if (intervalMinutes === null) return null;
  return { intervalMinutes, timeoutSeconds, batch, concurrency };
}

/** Return the OIDC settings, or null when none of the required ones is set. */
function loadOidc(raw: RawConfig, publicUrl: string, problems: string[]): OidcConfig | null {
  const set = OIDC_REQUIRED.filter((name) => raw[name]?.trim());
  if (set.length === 0) return null;
  if (set.length < OIDC_REQUIRED.length) {
    const missing = OIDC_REQUIRED.filter((name) => !set.includes(name));
    problems.push(`OIDC sign-in needs ${OIDC_REQUIRED.join(", ")} together; missing: ${missing.join(", ")}.`);
    return null;
  }
  const discoveryUrl = raw.OIDC_DISCOVERY_URL!.trim();
  const protocol = URL.canParse(discoveryUrl) ? new URL(discoveryUrl).protocol : "";
  if (publicUrl.startsWith("https://") ? protocol !== "https:" : !["http:", "https:"].includes(protocol)) {
    problems.push("OIDC_DISCOVERY_URL must be the provider's absolute discovery URL, in https when PUBLIC_URL is.");
  }
  const scopes = (raw.OIDC_SCOPES?.trim() || "openid email profile").split(/[\s,]+/).filter(Boolean);
  return {
    discoveryUrl,
    clientId: raw.OIDC_CLIENT_ID!.trim(),
    clientSecret: raw.OIDC_CLIENT_SECRET!.trim(),
    providerName: raw.OIDC_PROVIDER_NAME?.trim() || "SSO",
    groupsClaim: raw.OIDC_GROUPS_CLAIM?.trim() || "groups",
    allowedGroups: list(raw.OIDC_ALLOWED_GROUPS),
    adminGroups: list(raw.OIDC_ADMIN_GROUPS),
    scopes: [...new Set(scopes)],
  };
}

/**
 * Validate the raw environment and return the configuration.
 *
 * Throws a ConfigError listing every problem at once.
 */
export function loadConfig(raw: RawConfig): Config {
  const problems: string[] = [];

  const authSecret = raw.AUTH_SECRET?.trim() ?? "";
  if (authSecret.length < MIN_AUTH_SECRET) {
    problems.push(`AUTH_SECRET must be set, with at least ${MIN_AUTH_SECRET} characters (openssl rand -base64 32).`);
  }

  const publicUrl = raw.PUBLIC_URL?.trim().replace(/\/+$/, "") ?? "";
  if (!URL.canParse(publicUrl) || !["http:", "https:"].includes(new URL(publicUrl).protocol)) {
    problems.push("PUBLIC_URL must be the absolute http(s) URL users open, e.g. https://portal.example.org.");
  }

  const setupCode = raw.SETUP_CODE?.trim() || null;
  if (setupCode !== null && setupCode.length < MIN_SETUP_CODE) {
    problems.push(`SETUP_CODE must have at least ${MIN_SETUP_CODE} characters (openssl rand -base64 24).`);
  }

  let sessionMaxAge = DEFAULT_SESSION_MAX_AGE;
  const rawMaxAge = raw.SESSION_MAX_AGE?.trim();
  if (rawMaxAge) {
    if (/^\d+$/.test(rawMaxAge) && Number(rawMaxAge) > 0) sessionMaxAge = Number(rawMaxAge);
    else problems.push("SESSION_MAX_AGE must be a whole number of seconds.");
  }

  let auditRetentionDays = DEFAULT_AUDIT_RETENTION_DAYS;
  const rawRetention = raw.AUDIT_RETENTION_DAYS?.trim();
  if (rawRetention) {
    const days = Number(rawRetention);
    if (/^\d+$/.test(rawRetention) && days >= MIN_AUDIT_RETENTION_DAYS && days <= MAX_AUDIT_RETENTION_DAYS) auditRetentionDays = days;
    else problems.push(`AUDIT_RETENTION_DAYS must be a whole number of days from ${MIN_AUDIT_RETENTION_DAYS} to ${MAX_AUDIT_RETENTION_DAYS}.`);
  }

  let trustProxy = 0;
  const rawTrustProxy = raw.TRUST_PROXY?.trim().toLowerCase();
  if (rawTrustProxy === "true") trustProxy = 1;
  else if (rawTrustProxy && rawTrustProxy !== "false") {
    if (/^\d+$/.test(rawTrustProxy)) trustProxy = Number(rawTrustProxy);
    else problems.push("TRUST_PROXY must be true, false or the number of proxies in front of YASAD.");
  }

  const rawLanguage = raw.DEFAULT_LANGUAGE?.trim().toLowerCase() || "en";
  const defaultLanguage = LANGUAGES.find((l) => l === rawLanguage);
  if (!defaultLanguage) problems.push(`DEFAULT_LANGUAGE must be one of: ${LANGUAGES.join(", ")}.`);

  const rawPasswordSignIn = raw.PASSWORD_SIGN_IN?.trim().toLowerCase() || "true";
  if (!["true", "false"].includes(rawPasswordSignIn)) problems.push("PASSWORD_SIGN_IN must be true or false.");
  const passwordSignIn = rawPasswordSignIn !== "false";

  if (publicUrl.startsWith("https://")) {
    if (authSecret.startsWith(EXAMPLE_PREFIX)) problems.push("AUTH_SECRET still holds the example value from .env.example.");
    if (setupCode?.startsWith(EXAMPLE_PREFIX)) problems.push("SETUP_CODE still holds the example value from .env.example.");
  }

  const oidc = loadOidc(raw, publicUrl, problems);
  const statusChecks = loadStatusChecks(raw, problems);

  if (problems.length > 0) throw new ConfigError(problems);
  return {
    authSecret,
    publicUrl,
    setupCode,
    trustProxy,
    sessionMaxAge,
    auditRetentionDays,
    defaultLanguage: defaultLanguage!,
    passwordSignIn,
    catalogFile: raw.CATALOG_FILE?.trim() || null,
    oidc,
    statusChecks: statusChecks!,
  };
}
