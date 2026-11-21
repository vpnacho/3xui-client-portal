'use strict';

/**
 * Tests for configurable SUB_PATH. Loads a fresh app with SUB_PATH=cars so the
 * custom path is registered at boot time, then verifies:
 *   (a) /api/public-config exposes subPath: "cars"
 *   (b) GET /cars/:token serves base64 subscription configs
 *   (c) GET /sub/:token does NOT serve subscription data (falls through to 404)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createPanelStub } = require('./fixtures');

// ---- fresh app with SUB_PATH=cars ------------------------------------------
// Set env BEFORE requiring the app module so publicConfig captures the value.
process.env.PANEL_URL = 'https://panel.example.com:2053/secret';
process.env.PANEL_USERNAME = 'admin';
process.env.PANEL_PASSWORD = 'pw';
process.env.PUBLIC_BASE_URL = 'https://sub.example.com';
process.env.SUB_PATH = 'cars';

// The existing api.test.js already required a copy of ../index without SUB_PATH.
// Clear the module registry so this file gets a truly fresh load with SUB_PATH=cars.
// We delete every server module that participates in the boot sequence.
for (const key of Object.keys(require.cache)) {
  if (
    key.includes('3xui-client-portal\\server') &&
    !key.includes('node_modules') &&
    !key.includes('test\\fixtures')
  ) {
    delete require.cache[key];
  }
}

const stub = createPanelStub();
globalThis.fetch = stub.fetchImpl;

const app = require('../index');
const { publicLimiter } = require('../index');

let server;
let port;

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  ({ port } = server.address());
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, headers, method: 'GET' },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// (a) /api/public-config must expose subPath: "cars"
test('GET /api/public-config exposes subPath "cars" when SUB_PATH=cars', async () => {
  const res = await get('/api/public-config');
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.subPath, 'cars', 'subPath must equal the configured SUB_PATH value');
});

// (b) GET /cars/:token serves base64 subscription configs and respects rate limiting
test('GET /cars/:token returns base64 subscription body', async () => {
  publicLimiter.limiter.reset();
  const res = await get('/cars/tokenalice01', { Accept: '*/*' });
  assert.equal(res.status, 200, 'custom path must respond with 200');
  assert.match(res.headers['content-type'], /text\/plain/);
  const decoded = Buffer.from(res.body.trim(), 'base64').toString('utf8');
  const lines = decoded.split('\n').filter(Boolean);
  assert.ok(lines.length >= 1, 'must return at least one config line');
  assert.ok(
    lines.every((l) => l.startsWith('vless://') || l.startsWith('trojan://')),
    'every line must be a vless:// or trojan:// URI',
  );
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('GET /cars/:token rate limiting returns 429 after exceeding the limit', async () => {
  publicLimiter.limiter.reset();

  // Exhaust the rate limit for this IP (default: 12 requests/minute).
  // We hit /cars/ so each request reaches the limiter, not the SPA bypass.
  const LIMIT = 12;
  for (let i = 0; i < LIMIT; i++) {
    await get('/cars/tokenalice01', { Accept: '*/*' });
  }
  const res = await get('/cars/tokenalice01', { Accept: '*/*' });
  assert.equal(res.status, 429, 'must be rate-limited after exceeding the threshold');
  assert.ok(
    res.headers['retry-after'],
    'rate-limited response must carry a Retry-After header',
  );
});

// (c) GET /sub/:token must NOT serve subscription data when SUB_PATH=cars
test('GET /sub/:token returns 404 when SUB_PATH=cars (not registered)', async () => {
  publicLimiter.limiter.reset();
  const res = await get('/sub/tokenalice01', { Accept: '*/*' });
  // Express finds no matching route → falls through to the 404 catch-all.
  assert.equal(res.status, 404, '/sub/:token must not be active when SUB_PATH=cars');
});

// SPA behaviour: browsers asking /cars/:token still get the SPA
test('browsers still get the SPA on /cars/:token', async () => {
  const res = await get('/cars/tokenalice01', { Accept: 'text/html' });
  assert.equal(res.status, 200);
  assert.ok(res.body.includes('id="root"'), 'SPA must be served for browser requests');
});
