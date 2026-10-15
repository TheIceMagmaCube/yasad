# First-run setup and minimal sign-in (issue #4)

Status: approved design, 2026-10-15. Implements #4, plus a minimal sign-in and sign-out so the instance stays usable until #6.

## Goal

On a fresh instance, the person who installs YASAD creates the first administrator from the browser, protected by a setup code. This local account is also the emergency access when the OIDC provider is down.

## Decisions this design relies on

From the Outline page "Décisions en vigueur" and `CLAUDE.md`:

- The setup code comes only from the `SETUP_CODE` environment variable. Setup is open only when no admin exists AND `SETUP_CODE` is set. After setup, the admin is told to restart without it; while it stays set with an admin present, YASAD warns.
- An empty database never reopens setup without a server-side action (setting `SETUP_CODE` again).
- Better Auth on Hono, Drizzle, one code for Docker (libSQL) and Workers (D1). Atomic writes with `db.batch`, never `db.transaction()`. No in-memory state in shared code.
- Session cookie HttpOnly, Secure, SameSite=Lax.
- No public sign-up, through the interface or the API.

## Scope

In scope:

- Configuration layer shared by both targets.
- Better Auth integration (schema, sessions, email and password sign-in and sign-out).
- Setup API and the two-step setup screen.
- Minimal sign-in screen and a placeholder signed-in page.
- Attempt limiting for the setup code, stored in the database.

Out of scope (later issues):

- Admin banner reminding to remove `SETUP_CODE` (#5, needs the app shell). The API already exposes the flag.
- French strings (#5). English strings live in one module, easy to extract.
- Full theme and shadcn/ui (#5). Plain Tailwind with AA contrast.
- Temporary passwords, switching password sign-in off, sign-in brute-force limiting (#6). The `rate_limit` table is reusable as is.
- Admin access recovery when the password is lost (open question in Outline).

## Backend architecture

### Configuration (`backend/src/config.ts`)

`createApp(getDb)` becomes `createApp({ getDb, getConfig })`. `server.ts` builds the raw config from `process.env`, `worker.ts` from the env bindings. A pure `loadConfig(raw)` validates it on both targets:

| Variable | Rule |
|---|---|
| `AUTH_SECRET` | Required, at least 32 characters. |
| `PUBLIC_URL` | Required, absolute URL. Drives `Secure` cookies and origin checks. |
| `SETUP_CODE` | Optional. When set, at least 24 characters. |
| `TRUST_PROXY` | Optional, `true` to read the client IP from `X-Forwarded-For` (Docker only). |
| `SESSION_MAX_AGE` | Optional, whole number of seconds, default `604800` (7 days). |

Invalid configuration: Docker refuses to start with a clear message; Workers answers 500 and logs the error.

Local development: `backend/.env.example` (versioned) is copied to `backend/.env` (git-ignored) and loaded by the dev script with `node --env-file-if-exists=.env`. The Workers equivalent is `backend/.dev.vars.example`, copied to `.dev.vars`. The example files hold dev-only values (a sample `AUTH_SECRET`, `PUBLIC_URL=http://localhost:5173`, a sample `SETUP_CODE`), so a fresh clone starts with `cp` and `npm run dev`. The README quick start documents both, and `TRUST_PROXY`.

### Better Auth (`backend/src/auth.ts`)

`createAuth(db, config)` builds one instance per request (the database depends on the env on Workers):

- Drizzle adapter, provider `sqlite`, `transaction: false` (the adapter's default; its `db.transaction()` paths are MySQL-only, checked in 1.7.9).
- `emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 }`.
- `user.additionalFields.role`: string, default `user`, `input: false`, so no client can set it. Same column as Better Auth's `admin` plugin, which #8 can adopt without a data migration.
- Mounted on `/api/auth/*`.

### Schema (`backend/src/schema.ts`)

- Better Auth tables: `user` (with `role`), `session`, `account`, `verification`. Generated, then reviewed.
- Setup marker: row `setup.completed` in the existing `setting` table.
- `rate_limit` table: `key` (primary key), `count`, `window_start`. Updated by a single atomic `UPDATE ... RETURNING` (or insert on first hit).
- Migration generated with `npm run db:generate --workspace backend` and committed.

### Setup routes (`backend/src/routes/setup.ts`)

- `GET /api/setup` returns `{ open: boolean }`. For a signed-in admin it also returns `setupCodeStillSet: boolean`.
- `POST /api/setup/verify-code { code }`: checks open, rate limit, code. `204` on success. Nothing is stored.
- `POST /api/setup { code, name, email, password, passwordConfirm }`: re-checks everything (open, rate limit, code, fields), hashes the password with Better Auth's hasher, then writes in one `db.batch`:
  1. insert `setting` `setup.completed` (primary key: a concurrent setup fails here and its whole batch rolls back),
  2. insert `user` with `role = admin`,
  3. insert `account` (provider `credential`, hashed password).

  Then opens the session through `auth.api.signInEmail` and returns its cookie.

Code comparison runs in constant time (hash both sides with SHA-256, then compare the digests byte by byte without early exit; works on both runtimes through Web Crypto).

### Setup state

`isSetupOpen(db, config)` = `config.setupCode` is set AND no **local** admin exists (a user with `role = admin` and a `credential` account). An OIDC admin (#9) never closes setup: the local emergency account must always be creatable. The `setting` marker is the concurrency guard, not the source of truth: a wiped database loses it, and setup still needs `SETUP_CODE`.

### Warning while `SETUP_CODE` stays set

- Docker: a warning at startup when an admin exists and `SETUP_CODE` is set.
- Workers: the same warning logged on each refused setup request.
- API flag `setupCodeStillSet` for the future admin banner (#5).

## Data flow

1. The frontend calls `GET /api/setup` on load.
2. `open: true`: every URL shows the setup flow. Otherwise, no session shows the sign-in screen, a session shows a placeholder home page (replaced by #10). No router yet; #5 adds one.
3. Step 1 posts the code to `verify-code`. The browser keeps the code in React state only (never `localStorage`, never the URL).
4. Step 2 posts the code again with the account fields. The server re-checks everything, so skipping step 1 gains nothing.
5. Step 3 confirms the admin is signed in and asks to remove `SETUP_CODE` and restart.

## Errors

Uniform body: `{ error: { code, message, ...details } }`.

| Case | HTTP | `code` |
|---|---|---|
| Setup closed (admin exists, or `SETUP_CODE` unset) | 404 | `setup_closed` |
| Wrong code | 403 | `invalid_code`, with `attemptsLeft` |
| Too many attempts (5 wrong codes per 15 minutes per IP) | 429 | `rate_limited`, with `Retry-After` |
| Invalid fields (e-mail, password under 12, confirmation mismatch) | 422 | `invalid_input`, with per-field details |
| Lost race: another setup just completed | 409 | `setup_closed` |

Attempt counter: one counter per IP (key `setup:<ip>`), shared by `verify-code` and `POST /api/setup`. Only wrong codes count. A right code does not reset it (setup closes right after anyway).

404 rather than 403 when closed, so the route does not reveal itself. Client IP: `CF-Connecting-IP` on Workers; on Docker the socket address, or `X-Forwarded-For` only when `TRUST_PROXY=true` (otherwise anyone could forge it and escape the limit). Behind a reverse proxy without `TRUST_PROXY`, every client shares the proxy IP and the limit becomes global; acceptable for setup (one installer), to revisit for sign-in in #6.

## Sessions

Handled by Better Auth: cookie HttpOnly, SameSite=Lax, Secure when `PUBLIC_URL` is https. Stored in the database, so they survive a restart. Duration: `SESSION_MAX_AGE` seconds (default 7 days), extended on use.

## User interface

Split screen on every auth page: brand panel on the left (logo from `assets/logo/`, name, tagline), form on the right. At 320 px the panel becomes a top bar.

1. Setup, step 1: setup code, hint pointing to `SETUP_CODE`, error with attempts left.
2. Setup, step 2: name, e-mail, password (at least 12 characters, no composition rules), confirmation, Back.
3. Setup done: admin signed in, notice to remove `SETUP_CODE` and restart, "Go to YASAD".
4. Sign-in: e-mail, password. Space kept for the SSO button (#9).

Accessibility: labels on every field, errors linked with `aria-describedby`, focus moves to the error summary on failure and to the step heading on step change, full keyboard flow, AA contrast.

## Tests

API tests in `backend/test/api/`, run on libSQL and D1. The harness `request()` accepts a config per test.

- Setup without a code, or with a wrong one: 403, attempts decrease.
- More than 5 attempts: 429, state in the database.
- `SETUP_CODE` unset, even on an empty database: 404.
- Valid setup: admin created with `role = admin`, session cookie returned, recognised by `GET /api/auth/get-session`.
- Second setup after success: 404.
- A user with `role = admin` but no `credential` account (future OIDC admin) does not close setup.
- Wrong codes across `verify-code` and `POST /api/setup` share one counter; right codes do not count.
- Short password, confirmation mismatch, invalid e-mail: 422, nothing written.
- Two concurrent setups (`Promise.all`): exactly one succeeds, the other gets 409.
- Public sign-up (`POST /api/auth/sign-up/email`) refused.
- Sign-in and sign-out with the created account.
- `role` cannot be set by the client (auth API and profile update).

Node-only tests:

- `loadConfig`: short `SETUP_CODE`, missing or short `AUTH_SECRET`, non-integer `SESSION_MAX_AGE` rejected.
- A fresh clone with `.env` copied from `.env.example` starts (`test/server/`).
- `test/server/`: `server.ts` refuses an invalid configuration; warns when `SETUP_CODE` stays set with an admin present.

Frontend (Vitest and Testing Library):

- Step 1 to step 2 to done; error messages; focus moves to errors.
