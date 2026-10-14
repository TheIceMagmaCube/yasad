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

To be written once milestone 1 ships.

## Contributing

Issues and ideas are welcome. Contribution guide to come.

## License

GNU Affero General Public License v3.0 (AGPL-3.0).
