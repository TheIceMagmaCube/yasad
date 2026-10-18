# Security policy

YASAD decides who sees which links, so a flaw in access control, sign-in or sessions matters even when it looks small.

## Supported versions

Only the latest release receives security fixes. YASAD is in 0.x: update to the latest version before reporting, if you can.

## Reporting a vulnerability

Do not open a public issue. Report it privately from the repository's **Security** tab, with **Report a vulnerability**.

Please include:

* the YASAD version, and whether it runs on Docker or Cloudflare Workers;
* the configuration that matters (local accounts, OIDC, `PASSWORD_SIGN_IN`, `TRUST_PROXY`), without secrets;
* the steps to reproduce, and what an attacker gains.

YASAD is maintained by one person, on a best-effort basis. You will get an answer to say whether the report is confirmed; a confirmed flaw is fixed before it is disclosed, and you are credited in the advisory unless you ask otherwise.

## In scope

* A person seeing a link, a category or any data their groups do not allow, through the interface or the API.
* Signing in, keeping a session, or gaining administrator rights without the right credentials.
* Bypassing the Content-Security-Policy, the same-origin check on state-changing requests, or the sign-in rate limits.
* Secrets (passwords, temporary passwords, tokens, `AUTH_SECRET`) reaching a log, a response or the browser.

## Out of scope

* A misconfiguration the documentation warns against, such as a `TRUST_PROXY` value that does not match the proxies in front of YASAD.
* Attacks that need an administrator account, unless they reach beyond what an administrator is meant to do.
* Volume-based denial of service.
