'use strict';

const path = require('node:path');
const fs = require('node:fs');

/**
 * Environment resolution order:
 *   1. variables already present in process.env (Docker `env_file`, `docker
 *      run -e`, systemd, or the shell) — always win;
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
const { XuiService, XuiError } = require('./xuiService');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');

/**
 * The Docker image keeps the repository layout (`/app/server` + `/app/client/dist`)
 * so this relative path resolves unchanged inside the container.
 */
const CLIENT_DIST = path.resolve(__dirname, '..', 'client', 'dist');
const CLIENT_INDEX = path.join(CLIENT_DIST, 'index.html');

const app = express();
const xui = new XuiService();

app.disable('x-powered-by');
app.set('trust proxy', true);

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
  };
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
  return res.status(status).type('text/plain').send(status >= 500 ? 'Service unavailable' : 'Not found');
}

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* -------------------------------------------------------------------------- */
/* API                                                                        */
/* -------------------------------------------------------------------------- */

app.get(
  '/api/client/:token',
  asyncRoute(async (req, res) => {
    const { token } = req.params;
    const client = await xui.getClientByToken(token);

    if (!client) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.set('Cache-Control', 'no-store');
    return res.json(toPublicClient(client, token));
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
  asyncRoute(async (req, res) => {
    const { token } = req.params;

    if (wantsHtml(req)) {
      return sendClientIndex(res);
    }

    const client = await xui.getClientByToken(token);
    if (!client) {
      return res.status(404).type('text/plain').send('Not found');
    }
    if (!client.vlessUri) {
      return res.status(409).type('text/plain').send('Subscription has no VLESS config');
    }

    const expire = client.expiryTime > 0 ? Math.floor(client.expiryTime / 1000) : 0;
    const body = Buffer.from(client.vlessUri, 'utf8').toString('base64');

    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Subscription-Userinfo': `upload=${client.upload}; download=${client.download}; total=${client.total}; expire=${expire}`,
      'Profile-Update-Interval': '12',
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

const server = app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] config source: ${envFileLoaded ? ENV_FILE : 'process.env only'}`);
  console.log(`[server] client build: ${fs.existsSync(CLIENT_INDEX) ? CLIENT_DIST : 'MISSING'}`);
  if (!PUBLIC_BASE_URL) console.warn('[server] PUBLIC_BASE_URL is not set');
  if (!xui.isConfigured) console.warn('[server] panel credentials are not configured - /api will return 502');
});

function shutdown(signal) {
  console.log(`[server] ${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;
