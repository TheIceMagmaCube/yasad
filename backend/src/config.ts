export type RawConfig = Record<string, string | undefined>;

export type Config = {
  authSecret: string;
  publicUrl: string;
  setupCode: string | null;
  trustProxy: boolean;
  sessionMaxAge: number;
};

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n- ${problems.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

export const MIN_AUTH_SECRET = 32;
export const MIN_SETUP_CODE = 24;
const DEFAULT_SESSION_MAX_AGE = 60 * 60 * 24 * 7;

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

  if (problems.length > 0) throw new ConfigError(problems);
  return { authSecret, publicUrl, setupCode, trustProxy: raw.TRUST_PROXY?.trim() === "true", sessionMaxAge };
}
