'use strict';

/**
 * End-to-end route tests: the real Express app with a stubbed panel fetch.
 * These lock in the privacy invariant from AGENTS.md.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { GB, createPanelStub } = require('./fixtures');

const stub = createPanelStub();
globalThis.fetch = stub.fetchImpl;

process.env.PANEL_URL = 'https://panel.example.com:2053/secret';
process.env.PANEL_USERNAME = 'admin';
process.env.PANEL_PASSWORD = 'pw';
process.env.PUBLIC_BASE_URL = 'https://sub.example.com';
process.env.ANNOUNCEMENT_TITLE = 'عنوان تستی';
process.env.FOOTER_AUTHOR_NAME = 'Tester';
process.env.ENABLE_HOME_LOOKUP = 'false';
process.env.PROFILE_UPDATE_INTERVAL = '6';

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
    const req = http.request({ host: '127.0.0.1', port, path, headers, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

const PRIVATE_KEYS = [
  'email',
  'enable',
  'upload',
  'download',
  'total',
  'expiryTime',
  'subscriptionUrl',
  'vlessUri',
];

test('GET /api/public-config exposes appearance settings only', async () => {
  const res = await get('/api/public-config');
  assert.equal(res.status, 200);

  const body = JSON.parse(res.body);
  assert.deepEqual(
    Object.keys(body).sort(),
    ['announcement', 'appTitle', 'enableHomeLookup', 'footer', 'profileUpdateInterval'].sort(),
  );
  assert.equal(body.footer.authorName, 'Tester');
  assert.equal(body.announcement.title, 'عنوان تستی');
  assert.equal(body.enableHomeLookup, false);
  assert.equal(body.profileUpdateInterval, 6);

  const flat = res.body.toLowerCase();
  for (const leak of ['panel.example.com', 'admin', 'pw', 'tokenalice', 'session']) {
    assert.ok(!flat.includes(leak), `public config leaked ${leak}`);
  }
});

test('GET /api/client/:token returns this client, all configs, no IPs', async () => {
  const res = await get('/api/client/tokenalice01', { Accept: 'application/json' });
  assert.equal(res.status, 200);

  const body = JSON.parse(res.body);
  // Privacy invariant: known fields plus the new live-status fields only.
  assert.deepEqual(
    Object.keys(body).sort(),
    [...PRIVATE_KEYS, 'configs', 'online', 'connections', 'countries'].sort(),
  );

  assert.equal(body.email, 'alice@example.com');
  assert.equal(body.total, 15 * GB);
  assert.equal(body.configs.length, 2);
  assert.equal(body.online, true);
  assert.ok(Number.isInteger(body.connections) && body.connections > 0);
  assert.ok(Array.isArray(body.countries));
  assert.ok(body.countries.every((c) => Number.isInteger(c.count) && c.count > 0));

  // Never another client, never an address, never panel internals.
  // (`secret` is this client's own trojan password, so it is expected here.)
  for (const leak of [
    'bob@example.com',
    'uuid-b',
    'uuid-disabled',
    '8.8.8.8',
    '1.1.1.1',
    '185.4.4.4',
    '3x-ui=',
  ]) {
    assert.ok(!res.body.includes(leak), `client payload leaked ${leak}`);
  }
  assert.equal(body.subscriptionUrl, 'https://sub.example.com/sub/tokenalice01');
});

test('GET /sub/:token returns every URI, newline-separated and base64 encoded', async () => {
  const res = await get('/sub/tokenalice01', { Accept: '*/*' });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/plain/);

  const decoded = Buffer.from(res.body.trim(), 'base64').toString('utf8');
  const lines = decoded.split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.ok(lines.every((line) => line.startsWith('vless://') || line.startsWith('trojan://')));
  assert.match(res.headers['subscription-userinfo'], /total=16106127360/);
  assert.equal(res.headers['profile-update-interval'], '6');
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('short tokens are rejected without contacting the panel', async () => {
  stub.state.calls.length = 0;
  const res = await get('/api/client/abc', { Accept: 'application/json' });
  assert.equal(res.status, 404);
  assert.equal(stub.state.calls.length, 0, 'panel must not be queried');
});

test('unknown tokens return 404 for both JSON and subscription routes', async () => {
  const api = await get('/api/client/unknown9999', { Accept: 'application/json' });
  assert.equal(api.status, 404);
  assert.deepEqual(JSON.parse(api.body), { error: 'Not found' });

  const sub = await get('/sub/unknown9999', { Accept: '*/*' });
  assert.equal(sub.status, 404);
});

test('a valid email is rejected with the same generic 404, panel untouched', async () => {
  stub.state.calls.length = 0;
  const api = await get('/api/client/alice%40example.com', { Accept: 'application/json' });
  assert.equal(api.status, 404);
  assert.deepEqual(JSON.parse(api.body), { error: 'Not found' });

  const sub = await get('/sub/alice%40example.com', { Accept: '*/*' });
  assert.equal(sub.status, 404);
  assert.equal(stub.state.calls.length, 0, 'panel must not be queried for an email');
});

test('tokens with whitespace or invalid characters are rejected before the panel', async () => {
  // Reset any failure-block state accumulated by prior 404 tests from 127.0.0.1.
  publicLimiter.limiter.reset();
  stub.state.calls.length = 0;
  const space = await get('/api/client/token%20alice01', { Accept: 'application/json' });
  assert.equal(space.status, 404);
  assert.deepEqual(JSON.parse(space.body), { error: 'Not found' });

  const plus = await get('/sub/token%2Bplus01', { Accept: '*/*' });
  assert.equal(plus.status, 404);

  const bang = await get('/sub/tokenalice01!', { Accept: '*/*' });
  assert.equal(bang.status, 404);
  assert.equal(stub.state.calls.length, 0, 'panel must not be queried');
});

test('browsers still get the SPA on /sub and /', async () => {
  const sub = await get('/sub/tokenalice01', { Accept: 'text/html' });
  assert.equal(sub.status, 200);
  assert.ok(sub.body.includes('id="root"'));

  const root = await get('/', { Accept: 'text/html' });
  assert.equal(root.status, 200);
  assert.ok(root.body.includes('Vazirmatn'));
});
