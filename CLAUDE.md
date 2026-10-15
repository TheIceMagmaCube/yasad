# YASAD

Self-hosted portal (Yet Another Simple Accessible Dashboard): each person sees one screen with the links their groups allow. Local accounts, OIDC, or both. AGPL-3.0.

Product decisions live in Outline, page "Décisions en vigueur" (https://outline.fabiengilles.tf/doc/decisions-en-vigueur-ypSeFfhluJ), child of "YASAD" in the IT collection. It is the only up-to-date reference: read it before changing behaviour, and propose an update there when a decision changes. The sibling page "Journal et analyse (historique)" is history only (it still mentions Django, which was dropped); never take a decision from it.

GitHub issues describe the need and the acceptance criteria, not the solution. Technical choices come from the decisions page and from this file.

## Layout

- `backend/`: Hono API, Drizzle (SQLite), Better Auth.
  - `src/app.ts`: runtime-agnostic app. Everything shared goes here or below. Each entry passes `getDb`, `getRawConfig` and `getClientIp`.
  - `src/config.ts`: environment validation, shared by both entries. `src/auth.ts`: Better Auth, mounted on `/api/auth/*`, public sign-up disabled.
  - `src/security.ts`: security headers (CSP and others) and the same-origin check on state-changing requests. `frontend/public/_headers` is generated from it for the Worker's static assets; a test fails when they drift.
  - `src/routes/`: YASAD routes; errors use `apiError()` (`{ error: { code, message } }`).
  - `src/server.ts`: Docker/Node entry (libSQL file, runs migrations at startup, serves `frontend/dist`).
  - `src/worker.ts`: Cloudflare Workers entry (D1 binding, static assets from `frontend/dist`).
  - `drizzle/`: generated SQL migrations, one set for both targets.
- `frontend/`: React, Vite, Tailwind, shadcn/ui. In dev, Vite proxies `/api` to the backend on :3000.
  - `src/theme/themes/<id>.css`: one file per preset theme, defining the tokens (shadcn variables plus `--header*`) in light and dark. Its id must also be in `backend/src/themes.ts`, `src/preferences.ts` and `public/theme-init.js` (tests check all four).
  - `src/i18n/`: `en.ts` defines the messages, `fr.ts` must satisfy the same type. `useStrings()` in components; no hard-coded interface text.
  - `src/components/ui/`: shadcn components, copied (`components.json`). `public/theme-init.js` sets theme, mode and language before the first paint.
  - `e2e/`: Playwright and axe against the built Docker entry, every theme in light and dark, at 320 px and 1280 px.

## Commands

- `npm run dev`: backend (:3000) and frontend (Vite) together. Needs `backend/.env` (copy `backend/.env.example`).
- `npm run lint`, `npm run typecheck`, `npm run build`.
- `npm test`: the API tests in `backend/test/api/` run twice, on libSQL (`test:node`) and inside workerd on D1 (`test:workers`). Write API tests against `testApp(env)` from `#harness` (fresh database, cookie jar, config overrides), never against a specific driver. Node-only tests live in `backend/test/server/` (real `server.ts` process) and `backend/test/unit/`; frontend tests (Vitest, Testing Library) next to the components.
- `npm run db:generate --workspace backend` after any change to `backend/src/schema.ts`; commit the migration (CI fails otherwise).
- `npm run build:worker --workspace backend`: Worker bundle dry run.
- `npm run test:e2e --workspace frontend`: builds the frontend, starts `server.ts` on :3199 with a fresh database and runs the browser tests (`npx playwright install chromium` once).
- `AUTH_SECRET=... SETUP_CODE=... docker compose up --build`: production image on :3000.

## Rules that must hold

- Two targets, one code: no Node-only API (`fs`, `child_process`, timers for background jobs) outside `server.ts`; no filesystem writes; scheduled work goes through a function both entries can trigger.
- Atomic writes use `db.batch([...])` (works on D1 and libSQL). Never `db.transaction()`: D1 does not support it.
- Access is deny by default. A link is visible only if the user holds a group on the link AND on its category (pages, when they come, will join the intersection). `@everyone` and `@authenticated` are system groups. Groups carry a `source` (`oidc`, `local`, `system`); an OIDC group never matches a local group of the same name.
- Filtering happens on the server; forbidden links never reach the browser, including through the API. Every access rule needs a test that calls the API directly.
- OIDC groups are written server-side from the verified ID token (Better Auth hook), never from user-editable fields.
- No automatic linking between a local account and an OIDC account sharing an e-mail.
- State-changing requests (POST, PUT, PATCH, DELETE), Better Auth routes included, must send a JSON body and come from PUBLIC_URL's origin. The CSP allows no inline script or style and no third-party origin: widen it in `security.ts` only, with the reason in the PR.
- WCAG 2.2 AA; keyboard navigation must work everywhere.
- Components use theme tokens only (`bg-background`, `text-primary`, `border-input`...), never raw Tailwind colors, so a theme can be swapped without touching them. A new theme must pass the E2E axe run in both modes.
- The API returns error codes, never sentences meant for display; the frontend translates them.
- Radix components that inject `<style>` (modal menus, Select, Dialog scroll lock) break the CSP: use non-modal variants or native elements. The E2E fails on any CSP violation.

## Conventions

- Code, comments, commits and the README in English. Outline docs in French.
- Branches `type/issue-topic` (e.g. `feat/12-oidc-login`), PR to `beta`, squash merge. `beta` is promoted to `main` by a PR merged with a merge commit (never squashed: semantic-release must see every commit, and `beta` must stay an ancestor of `main`).
- PR titles follow Conventional Commits (`feat:`, `fix:`, `chore:`...): semantic-release derives the version from them and publishes a git tag and a GitHub release (the release notes are the changelog). No version commit, no `CHANGELOG.md`: `package.json` stays at `0.0.0-development`, and the version is injected at build time (`APP_VERSION`).
- Versions stay in 0.x for now: versioning starts from the `v0.0.0` tag, `feat` and `fix` bump the patch, a breaking change bumps the minor (`.releaserc.json`). Going to 1.0.0 is a deliberate change of those rules.
- Node 24 (`.nvmrc`). TypeScript stays on 6.0.x until typescript-eslint supports 7.
