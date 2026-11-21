'use strict';

const path = require('node:path');
const fs = require('node:fs');

/**
 * Environment resolution order:
 *   1. variables already present in process.env (Docker `env_file`, `docker
 *      run -e`, systemd, or the shell) - always win;
 *   2. the shared root `.env` file, used for local development and only as a
 *      fallback for keys that are still missing.
 *
 * `dotenv` does not overwrite an existing key unless `override` is enabled, so
 * `override: false` keeps the precedence explicit.
 */
const ENV_FILE = process.env.DOTENV_CONFIG_PATH || path.join(__dirname, '..', '.env');

function loadEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return false;
  const result = require('dotenv').config({ path: ENV_FILE, override: false });
  return !result.error;
}

const envFileLoaded = loadEnvFile();

const express = require('express');
const { XuiService, XuiError, isValidSubscriptionToken } = require('./xuiService');
const { createLimiter } = require('./rateLimit');
const { summarizeCountries } = require('./geo');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');

const DEFAULT_ANNOUNCEMENT_TEXT =
  'این یک متن اطلاعیه تستی است. برای دریافت آخرین وضعیت سرورها و راهنمای اتصال این بخش را بررسی کنید.';

function readString(name, fallback = '') {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  return String(raw).trim();
}

function readBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const value = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return fallback;
}

function readPositiveInt(name, fallback, { min = 1, max = 24 * 60 } = {}) {
  const value = Number(String(process.env[name] ?? '').trim());
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < min || rounded > max) return fallback;
  return rounded;
}

/**
 * Everything under `publicConfig` is safe to hand to any browser: no panel
 * origin, credentials, token or client data is included.
 */
const publicConfig = {
  appTitle: readString('APP_TITLE', 'پنل اشتراک'),
  announcement: {
    enabled: readBool('ANNOUNCEMENT_ENABLED', true),
    title: readString('ANNOUNCEMENT_TITLE', 'اطلاعیه مهم'),
    text: readString('ANNOUNCEMENT_TEXT', DEFAULT_ANNOUNCEMENT_TEXT),
  },
  footer: {
    authorName: readString('FOOTER_AUTHOR_NAME', 'VPNacho'),
    authorUrl: readString('FOOTER_AUTHOR_URL', 'https://github.com/VPNacho'),
  },
  enableHomeLookup: readBool('ENABLE_HOME_LOOKUP', true),
  profileUpdateInterval: readPositiveInt('PROFILE_UPDATE_INTERVAL', 12, { max: 720 }),
};

/**
 * The Docker image keeps the repository layout (`/app/server` + `/app/client/dist`)
 * so this relative path resolves unchanged inside the container.
 */
const CLIENT_DIST = path.resolve(__dirname, '..', 'client', 'dist');
const CLIENT_INDEX = path.join(CLIENT_DIST, 'index.html');

const app = express();
const xui = new XuiService();

app.disable('x-powered-by');
/**
 * `TRUST_PROXY` controls how `X-Forwarded-For` is trusted. Behind the bundled
 * reverse proxy one hop is right; the default trusts the immediate proxy only,
 * so a direct caller cannot spoof the rate-limiter key. Set `TRUST_PROXY=true`
 * only when the portal itself sits behind a trusted CDN.
 */
const trustProxyRaw = String(process.env.TRUST_PROXY ?? '').trim();
const trustProxy = trustProxyRaw === '' ? 1 : Number.isFinite(Number(trustProxyRaw))
  ? Number(trustProxyRaw)
  : trustProxyRaw.toLowerCase() === 'true';
app.set('trust proxy', trustProxy);

/** Public link for a token, independent of the incoming host header. */
function subscriptionUrlFor(token) {
  const base = PUBLIC_BASE_URL || `http://localhost:${PORT}`;
  return `${base}/sub/${encodeURIComponent(token)}`;
}

function toPublicClient(client, token) {
  return {
    email: client.email,
    enable: client.enable,
    upload: client.upload,
    download: client.download,
    total: client.total,
    expiryTime: client.expiryTime,
    subscriptionUrl: subscriptionUrlFor(token),
    vlessUri: client.vlessUri,
    configs: Array.isArray(client.configs)
      ? client.configs.map(({ remark, protocol, network, security, uri }) => ({
          remark,
          protocol,
          network,
          security,
          uri,
        }))
      : [],
  };
}

/**
 * A token must be an exact panel `subId` (`^[A-Za-z0-9_-]{6,64}$`). Emails,
 * UUIDs, whitespace and any other shape are rejected before the panel is
 * contacted and answered with the same generic 404 as an unknown token, so
 * token existence is never leaked.
 */
function isPlausibleToken(token) {
  return isValidSubscriptionToken(token);
}

function wantsHtml(req) {
  const accept = String(req.headers.accept || '').toLowerCase();
  return accept.includes('text/html');
}

function sendClientIndex(res, { cache = false } = {}) {
  if (!fs.existsSync(CLIENT_INDEX)) {
    return res
      .status(503)
      .type('text/plain')
      .send('The client build is missing. Run `npm run build` inside client/.');
  }
  res.set('Cache-Control', cache ? 'public, max-age=60' : 'no-store');
  return res.sendFile(CLIENT_INDEX, { cacheControl: false });
}

function handleError(err, req, res, next) {
  if (res.headersSent) return next(err);

  const status = err instanceof XuiError ? err.status : 500;
  if (status >= 500) console.error('[server]', err.stack || err);

  if (req.path.startsWith('/api/')) {
    return res.status(status).json({
      error: status >= 500 ? 'Upstream panel is unavailable' : 'Bad request',
    });
  }
  return res
    .status(status)
    .type('text/plain')
    .send(status >= 500 ? 'Service unavailable' : 'Not found');
}

const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Rate-limit thresholds are configurable via env vars so operators can tune
 * them without rebuilding; the defaults stay at the safe production values.
 */
function readPositiveIntUnbounded(name, fallback) {
  const v = Number(String(process.env[name] ?? '').trim());
  return Number.isFinite(v) && v > 0 ? Math.round(v) : fallback;
}

/**
 * Strict, IP-based guard for requests that touch the panel (token probes):
 * 12 requests / minute, and >5 consecutive failures block the IP for 15 min.
 */
const publicLimiter = createLimiter({
  windowMs: readPositiveIntUnbounded('RATE_LIMIT_WINDOW_MS', 60_000),
  maxRequests: readPositiveIntUnbounded('RATE_LIMIT_MAX_REQUESTS', 12),
  failureThreshold: readPositiveIntUnbounded('RATE_LIMIT_FAILURE_THRESHOLD', 5),
  blockMs: readPositiveIntUnbounded('RATE_LIMIT_BLOCK_MS', 15 * 60_000),
  // A `text/html` request returns the SPA and never reaches the panel, so it
  // must not burn the 12/min token budget. An active block still applies.
  skip: (req) => wantsHtml(req),
});

/* -------------------------------------------------------------------------- */
/* API                                                                        */
/* -------------------------------------------------------------------------- */

app.get('/api/public-config', (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json(publicConfig);
});

app.get(
  '/api/client/:token',
  publicLimiter,
  asyncRoute(async (req, res) => {
    const { token } = req.params;

    if (!isPlausibleToken(token)) {
      return res.status(404).json({ error: 'Not found' });
    }

    const client = await xui.getClientByToken(token);
    if (!client) {
      return res.status(404).json({ error: 'Not found' });
    }

    let online = false;
    let geo = { connections: 0, countries: [] };
    try {
      online = await xui.isClientOnline(client.email);
    } catch {
      online = false;
    }
    // The IP log is historical, so the country breakdown is still meaningful
    // while the client is offline. Both calls are cheap and cached.
    try {
      geo = summarizeCountries(await xui.getClientIps(client.email));
    } catch {
      geo = { connections: 0, countries: [] };
    }

    res.set('Cache-Control', 'no-store');
    return res.json({
      ...toPublicClient(client, token),
      online,
      connections: geo.connections,
      countries: geo.countries,
    });
  }),
);

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Smart subscription endpoint                                                */
/* -------------------------------------------------------------------------- */

app.get(
  '/sub/:token',
  publicLimiter,
  asyncRoute(async (req, res) => {
    const { token } = req.params;

    if (wantsHtml(req)) {
      return sendClientIndex(res);
    }
    if (!isPlausibleToken(token)) {
      return res.status(404).type('text/plain').send('Not found');
    }

    const client = await xui.getClientByToken(token);
    if (!client) {
      return res.status(404).type('text/plain').send('Not found');
    }

    const uris = Array.isArray(client.uris) ? client.uris : [];
    if (uris.length === 0) {
      return res.status(409).type('text/plain').send('Subscription has no usable config');
    }

    const expire = client.expiryTime > 0 ? Math.floor(client.expiryTime / 1000) : 0;
    const body = Buffer.from(uris.join('\n'), 'utf8').toString('base64');

    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Subscription-Userinfo': `upload=${client.upload}; download=${client.download}; total=${client.total}; expire=${expire}`,
      'Profile-Update-Interval': String(publicConfig.profileUpdateInterval),
      'Profile-Title': `base64:${Buffer.from(client.email, 'utf8').toString('base64')}`,
      'Profile-Web-Page-URL': `${subscriptionUrlFor(token)}`,
    });

    return res.send(body);
  }),
);

/* -------------------------------------------------------------------------- */
/* Static client (React build)                                                */
/* -------------------------------------------------------------------------- */

app.use(
  express.static(CLIENT_DIST, {
    index: false,
    maxAge: '7d',
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    },
  }),
);

app.get('/', (req, res) => {
  if (wantsHtml(req) || req.accepts(['html', 'json']) === 'html') {
    return sendClientIndex(res);
  }
  return res.json({ ok: true });
});

// SPA fallback for the browser-facing subscription page.
app.get('/sub/:token/', (req, res) => {
  if (wantsHtml(req)) return sendClientIndex(res);
  return res.redirect(307, `/sub/${encodeURIComponent(req.params.token)}`);
});

app.use(handleError);
app.use((req, res) => res.status(404).type('text/plain').send('Not found'));

/**
 * Bind the port only when this file is the entry point. `node --test` imports
 * the app to exercise the routes on an ephemeral port instead.
 */
function start() {
  const server = app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
    console.log(`[server] config source: ${envFileLoaded ? ENV_FILE : 'process.env only'}`);
    console.log(`[server] client build: ${fs.existsSync(CLIENT_INDEX) ? CLIENT_DIST : 'MISSING'}`);
    if (!PUBLIC_BASE_URL) console.warn('[server] PUBLIC_BASE_URL is not set');
    if (!xui.isConfigured) {
      console.warn('[server] panel credentials are not configured - /api will return 502');
    }
  });

  function shutdown(signal) {
    console.log(`[server] ${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

if (require.main === module) start();

module.exports = app;
module.exports.publicConfig = publicConfig;
module.exports.publicLimiter = publicLimiter;
module.exports.start = start;
