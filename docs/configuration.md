# Configuration

YASAD reads its settings from environment variables and checks them all at once. When one is wrong, the error lists every problem:

* on Docker, YASAD prints it and stops at start;
* on Cloudflare Workers, every API request answers `invalid_config` and the Worker logs show the list.

Where to set them:

* **Docker:** with the example compose files ([compose.yaml](examples/compose.yaml), [caddy/compose.yaml](examples/caddy/compose.yaml)), add the variable to the `.env` file next to `compose.yaml`: they pass the whole file to YASAD (`env_file: .env`). Then run `docker compose up -d` again to apply it. A plain `docker compose restart` keeps the old values. You can also write it under `environment:` in `compose.yaml`.
* **Cloudflare Workers:** set each one as a secret, from `backend/`: `npx wrangler secret put AUTH_SECRET`. See [deployment.md](deployment.md#cloudflare-workers).

## Required

| Variable | Default | Example | Description |
|---|---|---|---|
| `AUTH_SECRET` | none | output of `openssl rand -base64 32` | Signs sessions. At least 32 characters. Keep it secret. |
| `PUBLIC_URL` | none | `https://portal.example.org` | The address people open in their browser, `http` or `https`. Cookies are `Secure` and HSTS is sent when it is `https`. Requests that change something (sign-in, forms) are refused when they come from another origin, so open YASAD at this exact address. |

With an `https` `PUBLIC_URL`, the configuration is refused when `AUTH_SECRET` or `SETUP_CODE` still holds an example value (starting with `dev-only-`) from `backend/.env.example` or `backend/.dev.vars.example`.

## First-run setup

| Variable | Default | Example | Description |
|---|---|---|---|
| `SETUP_CODE` | unset | output of `openssl rand -base64 24` | One-time code asked by the setup screen that creates the first administrator. At least 24 characters. Setup is open only while this code is set and no enabled local administrator exists. Remove it once setup is done. While it is still set after setup, Docker logs a warning at start, and both targets log one when someone submits a setup code. |

The setup screen allows 5 wrong codes per IP per 15 minutes.

## Sign-in and sessions

| Variable | Default | Example | Description |
|---|---|---|---|
| `SESSION_MAX_AGE` | `86400` (24 hours) | `28800` | How long a session lasts, in seconds, counted from sign-in. Using the session does not extend it: people sign in again once it ends. |
| `PASSWORD_SIGN_IN` | `true` | `false` | With `false`, only local administrators can sign in with a password, from `/sign-in/local`. Sessions already open are not closed and last until `SESSION_MAX_AGE` ends them: to close someone's sessions sooner, open the person's page under **Administration**, **People**, and check **Disabled**. See [oidc.md](oidc.md) for how the sign-in screen behaves then. |
| `DEFAULT_LANGUAGE` | `en` | `fr` | Interface language when the browser asks for neither English nor French: `en` or `fr`. |

Failed password sign-ins are limited in the database: 5 per e-mail and IP, and 30 per IP, per 15 minutes.

## Client IP and proxies

| Variable | Default | Example | Description |
|---|---|---|---|
| `TRUST_PROXY` | `false` (0 proxies) | `2` | Docker only. Number of proxies in front of YASAD. `true` means 1, `false` means 0. When it is above 0, the client IP is read from `X-Forwarded-For`; otherwise it is the address of the connection. |

The client IP keys the limits on setup and sign-in. Count every hop:

* YASAD reached directly: leave `TRUST_PROXY` unset. Otherwise anyone can forge the header.
* One reverse proxy (Caddy, Nginx, Traefik): `TRUST_PROXY=1`.
* Cloudflare in front of your reverse proxy (for example Nginx Proxy Manager): `TRUST_PROXY=2`.

With a value too low, every visitor shares the IP of a proxy. Then 5 wrong setup codes from anyone block setup for everyone for 15 minutes, failed sign-ins share one counter, and with OIDC everyone shares the limit of 300 sign-in starts and 300 provider answers per 15 minutes.

On Cloudflare Workers, the client IP always comes from the `CF-Connecting-IP` header. Do not set `TRUST_PROXY` there: it changes nothing, and a value that is not `true`, `false` or a number still makes the configuration invalid.

## Catalog

| Variable | Default | Example | Description |
|---|---|---|---|
| `CATALOG_FILE` | unset | `/config/catalog.yaml` | Docker only. Path, inside the container, of a catalog file applied at every start. The catalog then matches the file, and the **YAML file** page under **Links** no longer imports files; categories and links cannot be changed in the app either. An invalid file stops the start. Do not set it on Workers: no file is loaded there, but catalog imports and edits, and renaming or deleting the groups the catalog uses, are still refused. |

The file has the format of [catalog.example.yaml](catalog.example.yaml). To use it with the example compose files, put it at `config/catalog.yaml` next to `compose.yaml`, add `CATALOG_FILE=/config/catalog.yaml` to `.env`, and mount the folder in the `yasad` service:

```yaml
    volumes:
      - yasad-data:/data
      - ./config:/config:ro
```

Mount the folder, not the file alone: many editors save by replacing the file, and a container that mounts only the file keeps seeing the old one. Run `docker compose up -d` to apply the mount and the variable. Afterwards, edit the file and run `docker compose restart yasad` to apply it.

## Change history

| Variable | Default | Example | Description |
|---|---|---|---|
| `AUDIT_RETENTION_DAYS` | `365` | `730` | How many days the history of administrator actions keeps an entry, from 30 to 3650. Older entries are hidden at once and deleted, 100 at a time, by the next administrator actions. |

## Status checks

YASAD checks the links marked for it (`check: true` in the catalog file, or **Check availability** on the link's page) every minute: a cron trigger on Workers, a timer on Docker, which also runs once at startup. Each link is checked at most once per interval.

| Variable | Default | Example | Description |
|---|---|---|---|
| `STATUS_CHECK_INTERVAL_MINUTES` | `5` | `15` | Minutes between two checks of a link, from 1 to 1440. |
| `STATUS_CHECK_TIMEOUT_SECONDS` | `10` | `5` | Time allowed for one whole check, name resolution included, from 2 to 30 seconds. |
| `STATUS_CHECK_BATCH` | `10` | `50` | Links checked by one batch, from 1 to 200. |
| `STATUS_CHECK_CONCURRENCY` | `4` | `6` | Checks in flight at once, from 1 to 6. |

`ceil(STATUS_CHECK_BATCH / STATUS_CHECK_CONCURRENCY) × STATUS_CHECK_TIMEOUT_SECONDS` must stay at most 600 seconds, or the start stops.

On Docker, batches follow one another for up to 50 seconds in each minute. On Workers, each minute runs one batch, and the Free plan allows 50 subrequests per run: 3 per link plus the database, so about 15 links per run. A higher `STATUS_CHECK_BATCH` changes nothing there, and YASAD logs a warning when the checked links exceed what the interval allows. The Free plan also allows 5 cron triggers per account, shared by all its Workers; YASAD uses one.

Only public addresses are checked: a link that points to a private or reserved address, or to a name that resolves to one, gets an unknown status and is never contacted. Requests send `User-Agent: YASAD-status/<version>`, no cookie and no credential. On Workers, Cloudflare may add `Accept-Encoding` and `CF-Worker: <zone>`.

## Sign-in with OIDC

All optional. OIDC is on when `OIDC_DISCOVERY_URL`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` are set. Setting only one or two of them stops the start.

| Variable | Default | Example | Description |
|---|---|---|---|
| `OIDC_DISCOVERY_URL` | unset | `https://example.okta.com/.well-known/openid-configuration` | The provider's discovery URL. When `PUBLIC_URL` is `https`, it and the endpoints it lists must be `https` too. |
| `OIDC_CLIENT_ID` | unset | `0oa1b2c3d4e5f6g7h8i9` | Client ID of the application registered at the provider. |
| `OIDC_CLIENT_SECRET` | unset | (from the provider) | Client secret of that application. |
| `OIDC_PROVIDER_NAME` | `SSO` | `Okta` | Label of the sign-in button: "Sign in with Okta". |
| `OIDC_GROUPS_CLAIM` | `groups` | `groups` | ID token claim holding the groups, a list or a single string. |
| `OIDC_ALLOWED_GROUPS` | empty | `portal-staff,portal-admins` | Comma-separated, with the names as the provider sends them, without the `oidc:` prefix used in the catalog. When set, only their members, and members of admin groups, can sign in. Empty: anyone the provider accepts. |
| `OIDC_ADMIN_GROUPS` | empty | `portal-admins` | Comma-separated groups whose members are administrators, named as the provider sends them, without the `oidc:` prefix. Empty: nobody is administrator through the provider. A role set on the person's page under **People** takes precedence. |
| `OIDC_SCOPES` | `openid email profile` | `openid email profile groups` | Scopes requested, separated by spaces or commas. Some providers need `groups`. |

Provider setup and behaviour: [oidc.md](oidc.md).

## Themes

The theme is not an environment variable. YASAD ships `default` and `dusk`, each in light and dark; each person picks light, dark or the system setting. An instance set to a theme YASAD no longer ships, such as `night`, shows `default`.

## Set by the Docker image

The image already sets these. You only change them for an unusual setup.

| Variable | Value in the image | Default outside the image | Description |
|---|---|---|---|
| `DATABASE_URL` | `file:/data/yasad.db` | `file:data/yasad.db` | libSQL URL of the SQLite database. Keep `/data` on a volume, or the data is lost when the container is replaced. |
| `PORT` | `3000` | `3000` | Port YASAD listens on. |
| `MIGRATIONS_DIR` | `/app/drizzle` | `drizzle` | Folder of the database migrations, applied at every start. |
| `STATIC_DIR` | `/app/public` | `../frontend/dist` | Folder of the built frontend. |

On Cloudflare Workers these do not apply: the database is the D1 binding `DB` and the frontend is served as static assets, both set in `backend/wrangler.jsonc`.
