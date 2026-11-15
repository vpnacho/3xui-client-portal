# 3x-ui Client Portal

Read-only subscription portal for a [3x-ui (MHSanaei)](https://github.com/MHSanaei/3x-ui) panel.
Each client gets a personal page at `/sub/:token` that exposes **only their own**
usage, expiry and VLESS link - no panel credentials, no other users' data.

- `server/` - Node.js + Express, talks to the panel API, builds official `vless://` links.
- `client/` - React + Vite + Tailwind subscription page (RTL, Persian UI).

## Endpoints

| Route | Purpose |
| --- | --- |
| `GET /sub/:token` | Browser gets the HTML page. Client apps (Happ, Karing, Streisand, v2rayNG, ...) get the base64 subscription with `Subscription-Userinfo` headers. |
| `GET /api/client/:token` | JSON for the subscription page (`404` when the token is unknown). |
| `GET /api/health` | Liveness probe used by `HEALTHCHECK`. |

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
| `VLESS_HOST` | Host/IP written into `vless://` links. Set it when the panel listen address is `0.0.0.0` or sits behind a proxy/CDN. |

Variables injected by Docker (`env_file`, `-e`, `environment`) take precedence;
`server/index.js` falls back to a local `.env` file only for keys that are
still missing.

`VLESS_HOST` has no safe default. If you leave it empty and the inbound listens
on `0.0.0.0`, links use the panel hostname — which is usually correct only when
the panel and the proxy share a public address. Set it explicitly in production.

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
