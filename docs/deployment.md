# Deployment

YASAD runs as one Docker image or as a Cloudflare Worker. The image does not handle TLS: put a reverse proxy in front of it. Every variable is described in [configuration.md](configuration.md), and the themes YASAD ships are listed in its [Themes](configuration.md#themes) section.

## Docker behind Caddy

[Caddy](https://caddyserver.com) gets and renews the HTTPS certificate by itself. You need a domain name whose DNS record points to the machine, with ports 80 and 443 open to the internet.

1. Download the two example files into a new folder:

   ```sh
   mkdir yasad && cd yasad
   curl -fsSLO https://raw.githubusercontent.com/TheIceMagmaCube/yasad/main/docs/examples/caddy/compose.yaml
   curl -fsSLO https://raw.githubusercontent.com/TheIceMagmaCube/yasad/main/docs/examples/caddy/Caddyfile
   ```

   [compose.yaml](examples/caddy/compose.yaml) runs YASAD and Caddy. YASAD publishes no port: only Caddy reaches it, and `TRUST_PROXY` is `1`.

   [Caddyfile](examples/caddy/Caddyfile):

   ```
   portal.example.org {
   	reverse_proxy yasad:3000
   }
   ```

2. Replace `portal.example.org` in the Caddyfile with your domain.
3. Create the `.env` file, with your domain in `PUBLIC_URL`:

   ```sh
   cat > .env <<EOF
   AUTH_SECRET=$(openssl rand -base64 32)
   SETUP_CODE=$(openssl rand -base64 24)
   PUBLIC_URL=https://portal.example.org
   EOF
   ```

4. Start: `docker compose up -d`.
5. Open `https://portal.example.org` and follow the first install from the [README](../README.md#quick-start): setup code, administrator, catalog. Then remove the `SETUP_CODE` line from `.env` and run `docker compose up -d` again.

## Behind Nginx Proxy Manager and Cloudflare

Any reverse proxy works. This section assumes Nginx Proxy Manager runs in Docker, with Cloudflare in front of it.

Put YASAD on Nginx Proxy Manager's Docker network and publish no port. Find that network's name with `docker network ls` (often `<folder of Nginx Proxy Manager>_default`), then use this `compose.yaml`, with that name in place of `npm_default`:

```yaml
services:
  yasad:
    image: ghcr.io/theicemagmacube/yasad:latest
    env_file: .env
    environment:
      AUTH_SECRET: ${AUTH_SECRET:?set AUTH_SECRET in .env (openssl rand -base64 32)}
      PUBLIC_URL: ${PUBLIC_URL:?set PUBLIC_URL in .env, e.g. https://portal.example.org}
      SETUP_CODE: ${SETUP_CODE:-}
    # No ports: only Nginx Proxy Manager reaches YASAD.
    networks:
      - npm
    volumes:
      - yasad-data:/data
    restart: unless-stopped

networks:
  npm:
    external: true
    name: npm_default

volumes:
  yasad-data:
```

Create the `.env` file as in the Caddy steps above, and add `TRUST_PROXY=2` to it. Then carry over these settings:

* the proxy host forwards to hostname `yasad`, port `3000`, scheme `http`;
* in Cloudflare, set SSL/TLS to **Full (strict)** and give the proxy host a certificate for the domain (Let's Encrypt, or a Cloudflare Origin certificate). With **Flexible**, traffic between Cloudflare and Nginx Proxy Manager is not encrypted, and forcing SSL in Nginx Proxy Manager then loops;
* `PUBLIC_URL` is the address people open, for example `https://portal.example.org`;
* `TRUST_PROXY=2`, since two proxies stand in front of YASAD. With `1`, YASAD sees the address of a Cloudflare server instead of the visitor's, so many visitors share one IP and the setup and sign-in limits block them together;
* do not publish port 3000 to the internet: with `TRUST_PROXY` set, a client that reaches YASAD directly could forge its IP;
* Nginx Proxy Manager must accept traffic only from Cloudflare (allow only Cloudflare's IP ranges on the firewall, or use a Cloudflare Tunnel). Otherwise a client that bypasses Cloudflare can forge its IP too. Docker publishes ports ahead of host firewalls such as ufw, which then do not filter them: filter in the `DOCKER-USER` iptables chain or in your hosting provider's firewall, or use a Cloudflare Tunnel and publish no port.

## Cloudflare Workers

The same code runs on Cloudflare Workers, with a D1 database. You need a Cloudflare account, Git and Node 24. Use the `main` branch, which holds the last stable release (`beta` holds unreleased work).

1. Get the code and install the dependencies, then go to `backend/`:

   ```sh
   git clone -b main https://github.com/TheIceMagmaCube/yasad.git
   cd yasad
   npm ci
   cd backend
   ```

   Run every following command from `backend/`, except step 5.

2. Sign in to Cloudflare. `npx wrangler whoami` then shows your account.

   ```sh
   npx wrangler login
   ```

   `wrangler login` opens a browser. On a machine without one, for example a server reached over SSH, create an API token in the Cloudflare dashboard instead (template **Edit Cloudflare Workers**, plus the D1 Edit permission if the template lacks it) and export it: `export CLOUDFLARE_API_TOKEN=...`. With several accounts, also export `CLOUDFLARE_ACCOUNT_ID`.

3. Create the database:

   ```sh
   npx wrangler d1 create yasad
   ```

   It prints a `database_id`. When wrangler offers to add it to the configuration for you, answer no. Put the id in `backend/wrangler.jsonc`, in `d1_databases[0].database_id`. Keep the binding `DB` and `migrations_dir` `drizzle`.

4. Create the tables:

   ```sh
   npx wrangler d1 migrations apply yasad --remote
   ```

5. Build the frontend, at the root of the repository. The Worker serves `frontend/dist` as static assets.

   ```sh
   cd ..
   npm run build --workspace frontend
   cd backend
   ```

6. Deploy, from `backend/`. It prints the address of the Worker, `https://yasad.<your-subdomain>.workers.dev`. The first upload of the static files can take a minute.

   ```sh
   npm run deploy:worker
   ```

   It sets the version from `git describe --tags --always`, like the Docker image, then runs `wrangler deploy`. Arguments after `--` go to `wrangler deploy`, for example `npm run deploy:worker -- --config <file>`.

7. Set the secrets. Each command asks for the value.

   ```sh
   npx wrangler secret put AUTH_SECRET   # output of: openssl rand -base64 32
   npx wrangler secret put PUBLIC_URL    # the workers.dev address or your custom domain, in https
   npx wrangler secret put SETUP_CODE    # output of: openssl rand -base64 24
   ```

   To use your own domain, add it to the Worker in the Cloudflare dashboard (Settings, Domains & Routes): no file changes. Set `PUBLIC_URL` to that address and always open YASAD there: sign-in from the `workers.dev` address is then refused, since it is another origin.

   Set any other variable the same way, for example `PASSWORD_SIGN_IN` or the `OIDC_*` ones. Do not set `CATALOG_FILE` or `TRUST_PROXY` on Workers: `CATALOG_FILE` would block catalog imports and edits without loading any file, and the client IP always comes from `CF-Connecting-IP`.

8. Check that it answers: `https://<your-worker>/api/health` returns `{"ok":true,"version":"0.2.0-6-gac6136b","database":true}` (the version from step 6; `dev` only when deployed without git), and `/api/setup` returns `{"open":true}`.
9. Open `PUBLIC_URL` and follow the first install from the [README](../README.md#quick-start).
10. Once setup is done, delete the setup code:

    ```sh
    npx wrangler secret delete SETUP_CODE
    ```

### Update the Worker

1. At the root of the repository, get the new code. Your `database_id` is a local change to `backend/wrangler.jsonc`, so set it aside during the pull:

   ```sh
   git stash
   git pull
   git stash pop
   ```

   If `git stash pop` reports a conflict, edit `backend/wrangler.jsonc` to keep the new content with your `database_id`, then run `git reset` and `git stash drop`.
2. Run `npm ci` at the root, then repeat steps 4, 5 and 6: apply the new migrations, build the frontend, deploy.

## Update the Docker image

```sh
docker compose pull
docker compose up -d
```

YASAD applies the database migrations at every start.

## If nobody can sign in

Setup opens again only when `SETUP_CODE` is set and no enabled local administrator exists. While one exists, any other administrator, local or from the OIDC provider, can reset its password from the Users screen (**Reset password**). An administrator cannot reset their own password there.

YASAD has no way to recover the password of the only administrator. Create a second administrator early, for example an OIDC one through `OIDC_ADMIN_GROUPS`, so that one can always reset the other.
