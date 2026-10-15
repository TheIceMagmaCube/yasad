# App shell, theme and languages (issue #5, part B)

Status: approved design, 2026-10-15. Second half of #5; the security baseline (headers, cross-site protection) shipped in #21. This PR closes #5.

## Goal

Every screen shares one frame: a header with the instance title and logo, a user menu, a theme defined by design tokens in light and dark, and an interface in English or French. Accessibility (WCAG 2.2 AA) is checked in a real browser in CI.

## Decisions this design relies on

From the Outline page "Décisions en vigueur" and `CLAUDE.md`:

- Title, logo and theme are stored in the database and editable in the app; the default language comes from an environment variable.
- Frontend: React, Vite, Tailwind, shadcn/ui.
- WCAG 2.2 AA, keyboard navigation everywhere, i18n FR and EN.
- Two targets, one code. The CSP from #21 allows no inline script or style and no third-party origin.

## Scope

In:

- `GET /api/instance` and the `DEFAULT_LANGUAGE` variable.
- Two preset themes (`default`, `dusk`), each in light and dark.
- Per-person choice of language and appearance (System, Light, Dark), stored in the browser.
- App shell (skip link, header, user menu) and the signed-out screens with language and appearance selectors.
- shadcn/ui, with Setup and SignIn migrated to it.
- Translated interface (EN, FR), API errors translated by code.
- Playwright and axe in a new CI job.

Out (later issues):

- Admin screen to edit title, logo and theme; logo upload.
- Custom accent color (contrast computed on save).
- Groups in the user menu (#8); the menu shows the role until then.

## Backend

### `GET /api/instance`

Public, no session needed. Returns:

```json
{ "title": "YASAD", "logo": null, "theme": "default", "defaultLanguage": "en" }
```

- `title`, `logo`, `theme` come from the `setting` table, keys `instance.title`, `instance.logo`, `instance.theme`. Missing rows give the defaults: `"YASAD"`, `null` (built-in logo), `"default"`.
- A `theme` value that is not a known theme id returns `"default"`. The display never breaks on a bad value.
- `logo` is returned only when it is a same-origin path (starting with a single `/`) or a `data:image/` URI, the only sources the CSP allows; any other value returns `null`, the built-in logo.
- `Cache-Control: no-store`, so a change is seen on the next load.
- No migration: the `setting` table exists since #4. Nothing writes these keys yet except SQL.

### `DEFAULT_LANGUAGE`

`en` or `fr`, default `en`, validated in `config.ts` (any other value refuses to start, like the other variables). Added to `.env.example` and the README.

### Theme ids

`backend/src/themes.ts` exports `THEMES = ["default", "dusk"] as const`. A unit test checks that every id has a CSS file in `frontend/src/theme/themes/` and that every CSS file there has an id, the same way `_headers` is checked against `security.ts`.

## Frontend

### First paint

`frontend/public/theme-init.js` is loaded with a blocking `<script src>` in `<head>`, before the stylesheet (the CSP forbids inline scripts). It reads from `localStorage`, inside try/catch:

- `yasad.devTheme`: theme override, read only in dev builds (see Theme);
- `yasad.instanceTheme`: last instance theme seen, else `default`;
- `yasad.mode`: `system`, `light` or `dark`, else `system`;
- `yasad.language`: `en` or `fr`, if the person chose one;
- `yasad.instanceLanguage`: last `defaultLanguage` seen.

It sets `data-theme` (dev override, else cached instance theme), `data-mode` (resolved: `light` or `dark`, using `prefers-color-scheme` when the mode is `system`) and `lang` on `<html>`. The app shows its loading state until both `/api/instance` and the session are resolved, then applies the instance theme and language and caches them. If `/api/instance` fails, the app keeps the cached values (else the defaults) and carries on; no error screen for it. Only a first visit to an instance using a non-default theme can show `default` briefly.

### Theme

- `src/theme/themes/default.css` and `dusk.css` define the shadcn variables (`--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--primary-foreground`, `--secondary`, `--muted`, `--muted-foreground`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--radius`) under `[data-theme="<id>"]` and `[data-theme="<id>"][data-mode="dark"]`. Spacing and typography tokens live there too (font stack, base size).
- `index.css` maps them to Tailwind with `@theme inline` and declares `@custom-variant dark ([data-mode="dark"] &)`.
- Components use only token classes (`bg-background`, `text-primary`...), never raw colors. Replacing a theme touches no component.
- System font stack, no web font.
- `ThemeProvider` holds the mode, writes `yasad.mode`, updates `data-mode`, and follows `prefers-color-scheme` changes while the mode is `system`.
- Dev only (`import.meta.env.DEV`): the Appearance menu also offers the theme (`default`, `dusk`), stored in `yasad.devTheme` and taking precedence over the instance theme. Production builds ignore the key.
- `color-scheme` follows `data-mode` (`light` or `dark`), so native controls (select lists, scrollbars) match the mode.

### Languages

- `src/i18n/en.ts` defines the messages (strings and functions such as `invalidCode(left)`); its type is `Messages`. `src/i18n/fr.ts` is `satisfies Messages`, so a missing French key fails `tsc`.
- `LocaleProvider` picks the language: the person's choice (`yasad.language`), else the first browser language (`navigator.languages`) whose primary subtag is `en` or `fr` (`fr-CA` gives `fr`), else `defaultLanguage` from `/api/instance` (cached in `yasad.instanceLanguage`), else `en`. It keeps `<html lang>` in sync.
- `useStrings()` returns the current messages. `strings.ts` is removed.
- API errors are shown from their `code` (`messages.apiErrors[code]`), falling back to the generic message; the server's English `message` is never displayed.

### Components

- shadcn/ui is installed (components copied in `src/components/ui/`): Button, Input, Label, DropdownMenu. Setup and SignIn move to them; `Field` wraps Label and Input.
- The instance title is also the document title.
- `AppShell`: skip link ("Skip to content") to `<main id="content">`, header with logo and title on the left, `UserMenu` on the right.
- `UserMenu` (DropdownMenu, `modal={false}`): name, e-mail and role, Language submenu, Appearance submenu, Sign out. At 320 px the title truncates and the trigger shows the initials.
- `AuthLayout` shows the instance title and logo, with native `<select>` elements for language and appearance in its footer.
- Radix injects a `<style>` element for scroll locking in modal mode, which the CSP blocks. Hence `modal={false}` and native selects; the E2E test fails on any CSP violation.

## Tests and CI

- API tests (libSQL and D1, `testApp`): `/api/instance` defaults, stored values, unknown theme falls back to `default`, `defaultLanguage` from the config. Config test: an invalid `DEFAULT_LANGUAGE` is refused.
- Unit test: theme ids match the CSS files.
- Frontend tests (Vitest): language priority, mode switching and `data-mode`, user menu content and sign-out, API errors translated by code. Existing tests updated.
- E2E (`e2e/`, Playwright with `@axe-core/playwright`) against the built `server.ts` on a temporary database, theme set by SQL before each pass:
  - axe on Setup, SignIn and the signed-in home, for each theme, each mode, at 320 px and 1280 px;
  - keyboard test of the user menu: open, arrow keys, Escape, focus back on the trigger;
  - any CSP violation in the console fails the test.
- CI: a new `e2e` job after the build, with Chromium cached. `npm run test:e2e` runs it locally.

## Documentation

- `CLAUDE.md`: `src/theme/`, `src/i18n/`, `e2e/`, `npm run test:e2e`, the token-only rule for components.
- Outline "Décisions en vigueur": preset themes chosen by id, language and appearance chosen per browser, `DEFAULT_LANGUAGE`.
- Comment on #8: show groups in the user menu.

## Risks

- Playwright adds about a minute to CI; the browser cache keeps it there.
- shadcn components bring Radix dependencies; each one added later must pass the CSP check of the E2E.
