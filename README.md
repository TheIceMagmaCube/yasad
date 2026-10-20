# YASAD

**Yet Another Simple Accessible Dashboard.**

A self-hosted portal that gives each person one clean screen with the links, tools and dashboards they are allowed to see. Beautiful by default, customizable without writing code, with fine-grained access rules based on groups. Works with local accounts, your identity provider (OIDC), or both.

## Why another dashboard?

Most self-hosted dashboards make you choose:

* pretty but static (no real access control),
* customizable but configured by hand in YAML,
* multi-user but with permissions only at the board level.

YASAD aims to combine the three: a polished default look, a visual editor for dashboards and their layout, and access rules per link, category and dashboard based on groups.

## Goals

* **Beautiful and calm by default.** A good-looking theme out of the box, with few well-chosen options. Colors, logo and theme can be changed from the interface.
* **Easy to navigate, even when nearly empty.** Instant search (`/` or `Cmd+K`), full keyboard navigation, WCAG 2.2 AA, responsive layout.
* **SSO optional.** Run YASAD with local accounts only, with an OIDC provider only, or with both at the same time. Local accounts are created by an admin, never by public sign-up.
* **Access rules based on groups.** A person sees the union of what their groups allow: OIDC groups (read at each sign-in) and groups created in YASAD. A link is shown only if its category and dashboard are visible too, and nothing is visible until a group allows it. Built-in `@everyone` and `@authenticated` groups cover public and signed-in access. Filtering happens on the server: forbidden links are never sent to the browser.
* **Customizable without code.** Dashboards and their layout, categories, shortcuts, icons, theme and logo are edited in the interface.
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
* Several dashboards with a visual layout editor, favorites, service status, theming, widgets

## Tech stack

* **One language:** TypeScript on the server and in the browser.
* **Backend:** Hono with a REST API. Authentication (local accounts and OIDC) is handled by the backend with Better Auth, which sets an HttpOnly session cookie: tokens never reach the browser.
* **Frontend:** React, Vite, Tailwind CSS, shadcn/ui (Radix) for keyboard and screen reader accessibility.
* **Storage:** SQLite through Drizzle ORM: a SQLite file in Docker, D1 on Cloudflare Workers.
* **Packaging:** a single Docker image that serves the API and the frontend, or a Cloudflare Worker built from the same code. No reverse proxy is bundled: bring your own for TLS.

## Quick start

YASAD has no stable release yet: the examples use the `beta` image, built from the latest work merged for the next version.

You need Docker with Compose. Create a folder with this `compose.yaml` (also in [docs/examples/compose.yaml](docs/examples/compose.yaml)):

```yaml
services:
  yasad:
    image: ghcr.io/theicemagmacube/yasad:beta
    # Every variable in .env reaches YASAD (see docs/configuration.md).
    env_file: .env
    # Stop with a clear message when a required value is missing.
    environment:
      AUTH_SECRET: ${AUTH_SECRET:?set AUTH_SECRET in .env (openssl rand -base64 32)}
      PUBLIC_URL: ${PUBLIC_URL:?set PUBLIC_URL in .env, e.g. http://localhost:3000}
      SETUP_CODE: ${SETUP_CODE:-}
    ports:
      - "3000:3000"
    volumes:
      - yasad-data:/data
    restart: unless-stopped

volumes:
  yasad-data:
```

Next to it, create a `.env` file with a secret, a setup code and the address you will open:

```sh
cat > .env <<EOF
AUTH_SECRET=$(openssl rand -base64 32)
SETUP_CODE=$(openssl rand -base64 24)
PUBLIC_URL=http://localhost:3000
EOF
```

If you open YASAD from another machine, set `PUBLIC_URL` to that address instead, for example `http://192.168.1.10:3000`: requests from any other address are refused.

Then install:

1. Start YASAD: `docker compose up -d`. The database lives in a Docker volume, so it survives updates.
2. Open `PUBLIC_URL` (here http://localhost:3000). The **Set up YASAD** screen appears.
3. Enter the setup code from `.env`.
4. Create the first administrator: name, e-mail, and a password of 12 to 128 characters. This local account is also your emergency access if an identity provider is down. If you plan to sign in with an OIDC provider, give it an address that no account at the provider uses: YASAD refuses a provider sign-in whose e-mail belongs to a local account.
5. YASAD signs you in as that administrator. The **YASAD is ready** screen appears: select **Go to YASAD**. Its reminder about `SETUP_CODE` is step 8. Later, sign in from the **Sign in** screen with that e-mail and password.
6. Import a catalog: open **Admin**, then **Links**, then **YAML file**, and choose a YAML file. To try it, save [catalog.example.yaml](https://raw.githubusercontent.com/TheIceMagmaCube/yasad/beta/docs/catalog.example.yaml) on the computer you browse from. Check the preview, then select **Import**.
7. Go back to **My links**: the home page shows the links your groups allow. With the example file, an administrator sees the "Mail" link of "Everyday".
8. Remove the `SETUP_CODE` line from `.env` and run `docker compose up -d` again. Setup only opens while the code is set and no enabled local administrator exists.

`PUBLIC_URL` must be the exact address people type in their browser. For a real server, put YASAD behind a reverse proxy with HTTPS: see [docs/deployment.md](docs/deployment.md).

### Catalog

Admins edit categories and links in the **Links** section of the administration (**Admin** in the header), or as a YAML file: see [`docs/catalog.example.yaml`](docs/catalog.example.yaml) for the format. They import and export that file from **Links**, **YAML file**; importing shows what is added, changed and deleted before writing anything, and makes the catalog match the file exactly. On Docker, `CATALOG_FILE` applies a file at every start instead.

A link icon is `si:<slug>` ([Simple Icons](https://simpleicons.org)) or `lucide:<name>` ([Lucide](https://lucide.dev)). An icon the installed versions do not know is kept in the file, with a warning at import, and the link shows its first letter instead.

Keywords help the search in the header find a link. They are sent to everyone who can see the link, so they must not hold anything secret.

### Themes

YASAD ships two themes, each in light and dark: `default` (cream and ink, yellow accents, pixel touches) and `dusk` (warm creams and terracotta). Each person picks light, dark or the system setting under **Appearance**. An instance set to a theme YASAD no longer ships, such as `night`, shows `default`.

### Going further

* [Configuration](docs/configuration.md): every environment variable, with its default and an example.
* [Deployment](docs/deployment.md): behind Caddy with automatic HTTPS, behind Nginx Proxy Manager and Cloudflare, and on Cloudflare Workers with D1.
* [Sign-in with OIDC](docs/oidc.md): provider setup, with an Okta example.

### Development

```sh
npm ci
cp backend/.env.example backend/.env
npm run dev
```

Open http://localhost:5173 and use the setup code from `backend/.env`. For the Worker target: `cp backend/.dev.vars.example backend/.dev.vars`, then `npm run dev:worker --workspace backend`.

## Contributing

Issues and ideas are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). To report a security flaw, see [SECURITY.md](SECURITY.md).

## License

GNU Affero General Public License v3.0 (AGPL-3.0).

Fonts are served by YASAD itself, from [Fontsource](https://fontsource.org), under the SIL Open Font License 1.1: [Inter](https://github.com/rsms/inter), [Bricolage Grotesque](https://github.com/ateliertriay/bricolage), [Azeret Mono](https://github.com/displaay/azeret) and [Pixelify Sans](https://github.com/eifetx/Pixelify-Sans). The sign-in wordmark uses [Nabla](https://github.com/justvanrossum/nabla) (same licence), subset from the Google Fonts build to keep its colour tables; its licence is in `frontend/src/fonts/nabla-OFL.txt`.

Catalog icons are generated at build time (`scripts/generate-icons.mjs`), with their licences in `icons/<hash>/NOTICE.txt` next to them:

* [Lucide](https://lucide.dev): ISC, and MIT for the icons derived from Feather.
* [Simple Icons](https://simpleicons.org): data under CC0-1.0. The logos are trademarks of their owners; showing one identifies the linked service and implies no endorsement (see the Simple Icons [disclaimer](https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md)). Only icons with no licence of their own, or under CC0, the Unlicense, CC-BY or CC-BY-SA, are included; those under CC-BY or CC-BY-SA are credited in the notice with their source. Icons under any other licence (MIT, BSD, Apache, GPL, MPL, non-commercial, no-derivatives, custom) are left out and show the link's initial instead.
