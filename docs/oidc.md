# Sign-in with OIDC

YASAD can sign people in through an OpenID Connect provider, alone or next to local accounts. The variables are listed in [configuration.md](configuration.md#sign-in-with-oidc).

YASAD reads the groups from the **ID token** only, never from the userinfo endpoint. Any OIDC provider that puts the groups in the ID token should work. The example below is Okta, the provider YASAD has been tested with; Authentik is being tested.

## At the provider

Register a web application (authorization code flow, with a client secret) and set:

* the sign-in redirect URI `PUBLIC_URL/api/auth/callback/oidc`, for example `https://portal.example.org/api/auth/callback/oidc`;
* the sign-out redirect URI `PUBLIC_URL/signed-out`, for example `https://portal.example.org/signed-out`;
* an `email` claim and a groups claim in the ID token.

## Example: Okta

This example uses the org authorization server of a fictitious Okta domain, `https://example.okta.com`.

1. In the Okta Admin Console, create an app integration: **OIDC - OpenID Connect**, then **Web Application**.
2. Set the sign-in redirect URI to `https://portal.example.org/api/auth/callback/oidc` and the sign-out redirect URI to `https://portal.example.org/signed-out`.
3. On the **Assignments** tab, assign the people or groups who may use YASAD. Okta refuses the others.
4. On the **Sign On** tab, edit **OpenID Connect ID Token** and set a groups claim:
   * **Groups claim type:** Filter;
   * **Groups claim filter:** name `groups`, then a filter. **Matches regex** `.*` sends every group, which is handy for a test. In production, send only the groups YASAD needs, for example **Starts with** `portal-`.

   Without this filter, the ID token carries no `groups` claim, and YASAD sees no group for anyone. With `OIDC_ALLOWED_GROUPS` set, nobody can sign in, and `OIDC_ADMIN_GROUPS` makes nobody an administrator.
5. Copy the client ID and the client secret from the **General** tab.

Then configure YASAD. On Docker with the example compose files, add these lines to `.env`:

```sh
OIDC_DISCOVERY_URL=https://example.okta.com/.well-known/openid-configuration
OIDC_CLIENT_ID=0oa1b2c3d4e5f6g7h8i9
OIDC_CLIENT_SECRET=the-client-secret
OIDC_PROVIDER_NAME=Okta
OIDC_SCOPES="openid email profile groups"
OIDC_ADMIN_GROUPS=portal-admins
```

If you write them under `environment:` in `compose.yaml` instead, write `OIDC_SCOPES: openid email profile groups` without quotes. On Workers, set each value with `npx wrangler secret put`.

Apply it: on Docker, run `docker compose up -d` again (`docker compose restart` keeps the old values); on Workers, a secret applies as soon as it is set. The sign-in screen now shows **Sign in with Okta**. In the catalog, refer to an Okta group as `oidc:<name>`, with the exact name and case, for example `oidc:portal-staff`.

## How it behaves

* Accounts are created at the first sign-in and keyed on the provider's issuer and subject, never on the e-mail. Name and e-mail are copied from the ID token at each sign-in: the provider is the source of truth.
* Every group in the claim becomes an `oidc:<name>` group, created if missing. The person's provider memberships are replaced at each sign-in, so removing someone from a group at the provider takes effect at their next sign-in. An `oidc` group never matches a `local` group of the same name.
* A sign-in whose ID token marks the e-mail as unverified is refused.
* A provider account never takes over a local account with the same e-mail: the sign-in is refused. Give the emergency local administrator an address of its own. If a local account already uses a person's provider address, change its e-mail in the Users screen (**Edit**) before that person signs in with the provider.
* With `PASSWORD_SIGN_IN=false`, the sign-in screen sends people straight to the provider (not when `/` shows public links, after an error, or on `/signed-out`). Local administrators keep `/sign-in/local`, also linked from the error and signed-out screens.
* While setup is open, its first step (the setup code) also offers the provider's sign-in.
* Signing out of YASAD also ends the session at the provider when the provider offers that. Other applications of the same provider then ask to sign in again.
* Changing provider: delete the old OIDC accounts in the Users screen first. They are created again at the next sign-in.
* Starting a sign-in and receiving the provider's answer are each limited to 300 per IP per 15 minutes, enough for an office behind one address.
