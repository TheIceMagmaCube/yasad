# YASAD

**Yet Another Simple Accessible Dashboard.**

A self-hosted portal that gives each person one clean screen with the links, tools and pages they are allowed to see. Beautiful by default, customizable without writing code, with fine-grained access rules based on groups. Works with local accounts, your identity provider (OIDC), or both.

## Why another dashboard?

Most self-hosted dashboards make you choose:

* pretty but static (no real access control),
* customizable but configured by hand in YAML,
* multi-user but with permissions only at the board level.

YASAD aims to combine the three: a polished default look, a visual editor for pages and links, and access rules per link, page and category based on groups.

## Goals

* **Beautiful and calm by default.** A good-looking theme out of the box, with few well-chosen options. Colors, logo and theme can be changed from the interface.
* **Easy to navigate, even when nearly empty.** Instant search (`/` or `Cmd+K`), full keyboard navigation, WCAG 2.2 AA, responsive layout.
* **SSO optional.** Run YASAD with local accounts only, with an OIDC provider only, or with both at the same time. Local accounts are created by an admin, never by public sign-up.
* **Access rules based on groups.** A person sees the union of what their groups allow: OIDC groups (read at each sign-in) and groups created in YASAD. A link is shown only if its category and page are visible too, and nothing is visible until a group allows it. Built-in `@everyone` and `@authenticated` groups cover public and signed-in access. Filtering happens on the server: forbidden links are never sent to the browser.
* **Customizable without code.** Pages, categories, shortcuts, icons, theme and logo are edited in the interface.
* **Modular.** The core is small. Favorites, service status and widgets are modules you can switch off.
* **Provider agnostic.** Any OIDC provider works (Okta, Authentik, Keycloak, and others), configured with environment variables. OIDC users are created on first sign-in and can be managed in the app.
* **Simple to host.** One Docker image that serves everything, simple. The same code also runs on Cloudflare Workers with D1.

## Non-goals (for now)

* No password management for SSO users: your identity provider stays the source of truth for their authentication.
* No public sign-up page. Local accounts are created by an admin.
* Not a monitoring dashboard. Service status is a simple up or down indicator.

## Planned scope

**Milestone 1, core**

* Setup screen that creates the first admin account (a local account, also the emergency access if the OIDC provider is down)
* Local accounts created by an admin with a temporary password, changed by the user at first sign-in
* Optional OIDC sign-in, sign-out for both account types, current user and groups shown in the header
* Link catalog with categories, loaded from a YAML file (import and export) until the admin screens of milestone 2
* Server-side filtering by group
* Instant search

**Milestone 2, administration**

* Admin screens for links, categories, users and groups
* Change log (who, what, when)

**Later**

* Password reset by email, two-factor authentication for local accounts
* Visual page editor, favorites, service status, theming, widgets

## Tech stack

* **One language:** TypeScript on the server and in the browser.
* **Backend:** Hono with a REST API. Authentication (local accounts and OIDC) is handled by the backend with Better Auth, which sets an HttpOnly session cookie: tokens never reach the browser.
* **Frontend:** React, Vite, Tailwind CSS, shadcn/ui (Radix) for keyboard and screen reader accessibility.
* **Storage:** SQLite through Drizzle ORM: a SQLite file in Docker, D1 on Cloudflare Workers.
* **Packaging:** a single Docker image that serves the API and the frontend, or a Cloudflare Worker built from the same code. No reverse proxy is bundled: bring your own for TLS.

## Quick start

Milestone 1 is in progress: for now YASAD covers the first-run setup and sign-in.

```sh
docker run -d -p 3000:3000 -v yasad-data:/data \
  -e AUTH_SECRET="$(openssl rand -base64 32)" \
  -e PUBLIC_URL=https://portal.example.org \
  -e SETUP_CODE="$(openssl rand -base64 24)" \
  ghcr.io/theicemagmacube/yasad:beta
```

Open `PUBLIC_URL`, enter the setup code and create the first administrator. Then remove `SETUP_CODE` and restart: setup only opens while no local administrator exists and the code is set. While setup is open and OIDC is configured, the setup screen also offers the provider's sign-in.

### Configuration

| Variable | Required | Description |
|---|---|---|
| `AUTH_SECRET` | yes | Signs sessions. At least 32 characters. |
| `PUBLIC_URL` | yes | The URL people open, e.g. `https://portal.example.org`. Cookies are `Secure` when it is https. |
| `SETUP_CODE` | for setup | One-time code for the first-run setup, at least 24 characters. Remove it once setup is done. |
| `SESSION_MAX_AGE` | no | Session lifetime in seconds, counted from sign-in: using the session does not extend it. Default `86400` (24 hours). |
| `PASSWORD_SIGN_IN` | no | `true` (default) or `false`. With `false`, only local administrators can sign in with a password, from `/sign-in/local`; sessions already open stay valid until they expire. |
| `CATALOG_FILE` | no | Docker only. Path of a catalog file applied at every start; the catalog then matches the file and cannot be imported from the interface. An invalid file stops the start. |
| `DEFAULT_LANGUAGE` | no | Interface language when the browser asks for neither English nor French: `en` (default) or `fr`. |
| `TRUST_PROXY` | no | Number of proxies in front of YASAD (`true` means 1). The client IP is then read from `X-Forwarded-For`. Leave it unset when YASAD is reached directly, otherwise anyone can forge the header. |
| `DATABASE_URL` | no | libSQL URL. Default `file:/data/yasad.db` in the image. |

Behind proxies, count every hop: with Cloudflare in front of your reverse proxy (for example Nginx Proxy Manager), set `TRUST_PROXY=2`. With a value too low, every visitor shares the IP of a proxy, so 5 wrong setup codes from anyone block setup for everyone for 15 minutes.

Failed sign-ins are limited in the database: 5 per e-mail and IP, 30 per IP, per 15 minutes. Set `TRUST_PROXY` correctly: with a value too low, every visitor shares one counter.

On Cloudflare Workers, set the same values as secrets (`wrangler secret put AUTH_SECRET`); the client IP comes from `CF-Connecting-IP`.

### Sign-in with OIDC

OIDC is on when the first three variables are set; setting only one or two of them stops the start.

| Variable | Default | Description |
|---|---|---|
| `OIDC_DISCOVERY_URL` | | The provider's discovery URL (`.../.well-known/openid-configuration`). When `PUBLIC_URL` is https, it and the endpoints it lists must be https too. |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | | The application registered at the provider. |
| `OIDC_PROVIDER_NAME` | `SSO` | Label of the sign-in button ("Sign in with Okta"). |
| `OIDC_GROUPS_CLAIM` | `groups` | ID token claim holding the groups, a list or a single string. |
| `OIDC_ALLOWED_GROUPS` | | Comma-separated. When set, only their members (and members of admin groups) can sign in. Empty: anyone the provider accepts. Either way, a sign-in whose ID token marks the e-mail as unverified is refused. |
| `OIDC_ADMIN_GROUPS` | | Comma-separated groups whose members are administrators, unless an admin set the person's role in the Users screen, which then takes precedence. |
| `OIDC_SCOPES` | `openid email profile` | Scopes requested; some providers need `groups` too. |

At the provider, register:

* the sign-in redirect URI `PUBLIC_URL/api/auth/callback/oidc`;
* the sign-out redirect URI `PUBLIC_URL/signed-out`;
* an `email` claim and a groups claim in the **ID token**. YASAD never reads groups from the userinfo endpoint. With Okta, set a "Groups claim filter" on the application's Sign On tab.

How it behaves:

* Accounts are created at the first sign-in and keyed on the provider's issuer and subject, never on the e-mail. Name and e-mail are copied from the ID token at each sign-in; the provider is the source of truth.
* Every group in the claim becomes an `oidc:<name>` group, created if missing, and the person's provider memberships are replaced at each sign-in. Removing someone from a group at the provider takes effect at their next sign-in. An `oidc` group never matches a `local` group of the same name.
* A provider account never takes over a local account with the same e-mail: the sign-in is refused. Give the emergency local administrator an address of its own.
* With `PASSWORD_SIGN_IN=false`, the sign-in screen sends people straight to the provider (not when `/` shows public links, after an error, or on `/signed-out`). Local administrators keep `/sign-in/local`, also linked from the error and signed-out screens.
* Signing out of YASAD also ends the session at the provider when it offers that, so other applications of the same provider will ask to sign in again.
* Changing provider: delete the old OIDC accounts in the Users screen first; they are created again at the next sign-in.
* Starting a sign-in and receiving the provider's answer are each limited to 300 per IP per 15 minutes, enough for an office behind one address.

### Catalog

Categories and links come from a YAML file: see [`docs/catalog.example.yaml`](docs/catalog.example.yaml) for the format. Admins import and export it from the "Catalog" page (account menu); importing shows what is added, changed and deleted before writing anything, and makes the catalog match the file exactly. On Docker, `CATALOG_FILE` applies a file at every start instead.

A link icon is `si:<slug>` ([Simple Icons](https://simpleicons.org)) or `lucide:<name>` ([Lucide](https://lucide.dev)). An icon the installed versions do not know is kept in the file, with a warning at import, and the link shows its first letter instead.

Keywords help the search in the header find a link. They are sent to everyone who can see the link, so they must not hold anything secret.

### Development

```sh
npm ci
cp backend/.env.example backend/.env
npm run dev
```

Open http://localhost:5173 and use the setup code from `backend/.env`. For the Worker target: `cp backend/.dev.vars.example backend/.dev.vars`, then `npm run dev:worker --workspace backend`.

## Contributing

Issues and ideas are welcome. Contribution guide to come.

## License

GNU Affero General Public License v3.0 (AGPL-3.0).

Catalog icons are generated at build time (`scripts/generate-icons.mjs`), with their licences in `icons/<hash>/NOTICE.txt` next to them:

* [Lucide](https://lucide.dev): ISC, and MIT for the icons derived from Feather.
* [Simple Icons](https://simpleicons.org): data under CC0-1.0. The logos are trademarks of their owners; showing one identifies the linked service and implies no endorsement (see the Simple Icons [disclaimer](https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md)). Only icons with no licence of their own, or under CC0, the Unlicense, CC-BY or CC-BY-SA, are included; those under CC-BY or CC-BY-SA are credited in the notice with their source. Icons under any other licence (MIT, BSD, Apache, GPL, MPL, non-commercial, no-derivatives, custom) are left out and show the link's initial instead.
