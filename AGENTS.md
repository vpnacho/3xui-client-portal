# Repository Guidelines

Read-only subscription portal for a 3x-ui (MHSanaei) panel. `server/` proxies the panel API and emits `vless://` links; `client/` renders the RTL Persian subscription page.

## Project Structure & Module Organization

- `server/index.js` — Express app, routes (`/sub/:token`, `/api/client/:token`, `/api/health`), static serving of `client/dist`.
- `server/xuiService.js` — panel login, cookie session, TTL cache, `vless://` builder. Keep all panel I/O here.
- `client/src/` — `App.jsx`, `components/` (PascalCase files), `hooks/`, `lib/` (pure helpers), `index.css` (Tailwind layers).
- Root — `Dockerfile`, `docker-compose.yml`, `.env.example`, `README.md`.

No test, lint, or format tooling is installed yet.

## Build, Test, and Development Commands

```bash
cd client && npm ci && npm run build   # required: server serves client/dist
cd server && npm ci && npm start       # http://localhost:3000
cd server && npm run dev               # watch mode
cd client && npm run dev               # Vite :5173, proxies /api and /sub
docker compose up -d --build           # needs a local .env
```

`server/index.js` resolves `../client/dist`, so do not change that relative path without updating the Dockerfile copy target.

## Coding Style & Naming Conventions

- 2-space indent, single quotes, semicolons, trailing commas, `'use strict'` in server files.
- `server/` is CommonJS (`require`/`module.exports`); `client/` is ESM.
- `PascalCase` components, `camelCase` functions/variables, `useX` hooks, `SCREAMING_SNAKE_CASE` module constants.
- Match the existing Persian copy and RTL markup (`dir="rtl"`, `Vazirmatn`).

## Testing Guidelines

There is no framework or coverage gate. When adding tests, prefer `node:test` for `server/` logic and Vitest for `client/`; name files `*.test.js`. At minimum assert the privacy invariant: `/api/client/:token` returns only `email, enable, upload, download, total, expiryTime, subscriptionUrl, vlessUri` and never other clients or panel data.

## Commit & Pull Request Guidelines

The repository has no commit history yet (initial commit pending). Use Conventional Commits, e.g. `feat(server): cache inbound list`, `fix(client): countdown overflow on 360px`. Pull requests should state the change, affected endpoints or components, and how it was verified; include screenshots for UI changes and link related issues.

## Security & Configuration Tips

- Never commit `.env`; document new keys in `.env.example` and `README.md`.
- `process.env` wins over `.env` (dotenv uses `override: false`) — rely on that in Docker.
- Set `PUBLIC_BASE_URL` and `VLESS_HOST` in production; links are built from them, not from request headers.
- Do not log credentials, cookies, or full client records.
