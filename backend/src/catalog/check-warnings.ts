import { checkTarget } from "../net/policy";

/** What a checked link's address means for its status, as a code the interface translates. */
export type CheckWarning = "check_blocked_address" | "check_blocked_port" | "check_login_gateway";

/** Okta domains: a link on a subdomain is a sign-in tile, so its status measures the sign-in page. A closed list. */
const LOGIN_GATEWAYS = ["okta.com", "oktapreview.com", "okta-emea.com"];

/**
 * Return what a checked link's address means for its status, from the address alone (no DNS): never contacted
 * (`check_blocked_address`, `check_blocked_port`, as the outbound policy will refuse it) or a sign-in page.
 * Shared by the catalog edits and the import preview.
 */
export function checkWarnings(url: string, check: boolean): CheckWarning[] {
  if (!check) return [];
  const target = checkTarget(url);
  // `invalid_target` (credentials in the URL) is refused as a blocked address by both outbound implementations.
  if (!target.ok) return [target.code === "blocked_port" ? "check_blocked_port" : "check_blocked_address"];
  // Subdomains only: okta.com itself is Okta's own site, not a tile. `target.host` is lower case without trailing dots.
  return LOGIN_GATEWAYS.some((domain) => target.host.endsWith(`.${domain}`)) ? ["check_login_gateway"] : [];
}
