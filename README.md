# 3x-ui Client Portal

[![CI / Build & Test](https://github.com/vpnacho/3xui-client-portal/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/vpnacho/3xui-client-portal/actions/workflows/ci.yml)

Read-only subscription portal for a [3x-ui (MHSanaei)](https://github.com/MHSanaei/3x-ui) panel.
Each client gets a personal page at `/sub/:token` that exposes **only their own**
usage, expiry and VLESS link - no panel credentials, no other users' data.

- `server/` - Node.js + Express, talks to the panel API, builds official `vless://` links.
- `client/` - React + Vite + Tailwind subscription page (RTL, Persian UI).

## Endpoints

| Route | Purpose |
| --- | --- |
| `GET /sub/:token` | Browser gets the HTML page. Client apps (Happ, Karing, Streisand, v2rayNG, ...) get **every** config of that `subId`, newline-joined and base64-encoded, with `Subscription-Userinfo` headers. |
| `GET /api/client/:token` | JSON for the subscription page (`404` when the token is unknown): usage, expiry, every config, live online state and per-country connection counts. |
| `GET /api/public-config` | Appearance settings only (title, announcement, footer, home lookup, refresh interval). No panel data. |
| `GET /api/health` | Liveness probe used by `HEALTHCHECK`. |

### Privacy invariants

- Raw client IPs never leave the server. `/api/client/:token` exposes only
  `{ connections, countries: [{ code, name, count }] }`.
- The response contains only `email, enable, upload, download, total,
  expiryTime, subscriptionUrl, vlessUri, configs, online, connections,
  countries` — never another client, never panel internals.
- Tokens shorter than 8 characters are rejected before the panel is contacted.

### Abuse protection

`/api/client/:token` and `/sub/:token` share one IP-based limiter:
12 requests/minute, and more than 5 consecutive failed (4xx/404) requests block
that IP for 15 minutes. State is in-process, so a single container instance is
assumed.

## Configuration

Copy the example file and fill in the panel details:

```bash
cp .env.example .env
```

| Variable | Description |
| --- | --- |
| `PORT` | Host port for `docker compose` (the container always listens on `3000`). |
| `PUBLIC_BASE_URL` | Public origin of this portal, used to build `/sub/:token` links. |
| `PANEL_URL` | Full panel base URL **including** the secret path, e.g. `https://panel.example.com:2053/secretpath`. |
| `PANEL_USERNAME`, `PANEL_PASSWORD` | Panel login. |
| `CACHE_TTL_SECONDS` | In-memory cache for the panel inbound list (`15` is a good default). |
| `APP_TITLE` | Page title (browser tab and header). |
| `ANNOUNCEMENT_ENABLED` | Show the announcement card (`true`/`false`). |
| `ANNOUNCEMENT_TITLE`, `ANNOUNCEMENT_TEXT` | Announcement copy. |
| `FOOTER_AUTHOR_NAME`, `FOOTER_AUTHOR_URL` | Footer credit and its link. |
| `ENABLE_HOME_LOOKUP` | Show the subscription lookup form on `/`. |
| `PROFILE_UPDATE_INTERVAL` | `Profile-Update-Interval` header in hours (`1`-`720`). |

Variables injected by Docker (`env_file`, `-e`, `environment`) take precedence;
`server/index.js` falls back to a local `.env` file only for keys that are
still missing.

### Connection details come from the panel

Links are built straight from the panel: `externalProxy` (address, port, SNI)
when the inbound defines one, otherwise the inbound `listen`/`port`. There is no
host override any more, so the address shown in the panel is the address clients
receive. If the panel listens on `0.0.0.0`/`127.0.0.1`, set a public
`externalProxy` (or the `listen` address) in the panel itself.

Sizes are taken as the panel reports them: `stats.total` is already **bytes**,
so a 5 GB plan renders as `5 GB`.

## Run with Docker Compose

`.env` must exist next to `docker-compose.yml` before the first start, because
`env_file` is read by Compose itself:

```bash
cp .env.example .env   # then edit the panel URL and credentials
```

```bash
# Build and start in the background
docker compose up -d --build

# Follow logs
docker compose logs -f xui-portal

# Update after pulling changes: rebuild and recreate the container
docker compose up -d --build --force-recreate

# Stop the service
docker compose down
```

`PUBLIC_BASE_URL` must be the public address users actually reach, otherwise the
subscription and import links in the UI point at the wrong host.

The build needs the internet once (npm registry). Put the whole project
directory on the server; `client/dist` is produced inside the image, so it does
not need to be committed or copied.

## Run without Docker

```bash
# Frontend first: server/index.js serves it from client/dist
cd client && npm ci && npm run build

# Backend (reads the root .env)
cd ../server && npm ci && npm start
```
