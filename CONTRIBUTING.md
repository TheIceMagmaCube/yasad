# Contributing to YASAD

Thanks for your interest. Bug reports, ideas and pull requests are welcome.

## Before you start

* **A bug**: open an issue with the bug template. A security flaw goes through [SECURITY.md](SECURITY.md) instead, never a public issue.
* **An idea or a change of behaviour**: open an issue first, so we can agree on the need before you write code. Issues describe the need and the acceptance criteria, not the solution.
* Work follows the milestones: the oldest open milestone is the active one, and a pull request outside it is usually limited to a fix.

## Set up

You need Node 24 (see `.nvmrc`).

```sh
npm ci
cp backend/.env.example backend/.env
npm run dev
```

Open http://localhost:5173 and use the setup code from `backend/.env`. For the Cloudflare Workers target: `cp backend/.dev.vars.example backend/.dev.vars`, then `npm run dev:worker --workspace backend`.

## Checks

CI runs all of these on every pull request; run the ones your change touches before pushing.

* `npm run lint`, `npm run typecheck`, `npm run build`.
* `npm test`: the API tests run twice, on libSQL and inside workerd on D1. Write them against `testApp()` from `#harness`, never against one driver.
* `npm run test:e2e --workspace frontend`: Playwright and axe on every theme, light and dark, at 320 and 1280 px (`npx playwright install chromium` once).
* After changing `backend/src/schema.ts`: `npm run db:generate --workspace backend`, and commit the migration.

## Rules a change must keep

* **Two targets, one code**: the same code runs on Docker (Node, libSQL) and Cloudflare Workers (D1). No Node-only API outside `backend/src/server.ts`, no filesystem writes, and atomic writes go through `db.batch()`, never `db.transaction()`.
* **Access is deny by default and filtered on the server**: a link a person may not see never reaches the browser, API included. Every access rule needs a test that calls the API directly.
* **Accessibility**: WCAG 2.2 AA and full keyboard use on every screen.
* **Themes**: components use theme tokens (`bg-background`, `text-primary`...), never raw colours.
* **Content-Security-Policy**: no inline script or style and no third-party origin. A change to the policy goes in `backend/src/security.ts`, with the reason in the pull request.
* **Text**: interface text lives in `frontend/src/i18n/`, in English and French. The API returns error codes, never sentences.

## Pull requests

* Branch from `beta`, named `type/issue-topic` (e.g. `fix/42-session-expiry`), and open the pull request against `beta`.
* The title follows [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:`, `chore:`...): pull requests are squash-merged, and the title becomes the commit that sets the next version and the release notes.
* One pull request does one reviewable thing. Link its issue with `Closes #N`.
* Code, comments, commits and documentation are in English.

## Licence

YASAD is under the [GNU AGPL v3.0](LICENSE). By contributing, you agree that your contribution is published under the same licence.
