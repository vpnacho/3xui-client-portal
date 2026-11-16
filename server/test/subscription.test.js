'use strict';

/**
 * `XUI_SUB_URL` behaviour: the panel's own Subscription service is the source of
 * truth for the config list, and its URIs are passed through untouched.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');

const {
  XuiService,
  XuiError,
  isInternalHost,
  parseSubscriptionBody,
  parseSubscriptionConfigs,
} = require('../xuiService');
const {
  RAW_SUBSCRIPTION_BASE64,
  RAW_SUBSCRIPTION_LINES,
  RAW_SUBSCRIPTION_TEXT,
  createPanelStub,
} = require('./fixtures');

/** Self-signed EC certificate for `localhost` / `127.0.0.1`, test only. */
const TLS_KEY = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIN6WlO2Smz3MJC/ScaomF3ovCrSwkQxDvhmjzp4aEbxDoAoGCCqGSM49
AwEHoUQDQgAEMJWCzLo+pELIpm/xHyApONEyQ319aOxcVSCnbIuiWgR7l70z6kgu
UQA7KcK7TzE4WLSeudUmieY02Rwy59n8RA==
-----END EC PRIVATE KEY-----`;
const TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIBmjCCAT+gAwIBAgIUPXvN7kdKCloKNwRzKPI/a3yc9EcwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MTExNjE0NTEyNloXDTQ2MTExMTE0
NTEyNlowFDESMBAGA1UEAwwJbG9jYWxob3N0MFkwEwYHKoZIzj0CAQYIKoZIzj0D
AQcDQgAEMJWCzLo+pELIpm/xHyApONEyQ319aOxcVSCnbIuiWgR7l70z6kguUQA7
KcK7TzE4WLSeudUmieY02Rwy59n8RKNvMG0wHQYDVR0OBBYEFGB18TC0+yt0qBET
d+YiPpkx7lkcMB8GA1UdIwQYMBaAFGB18TC0+yt0qBETd+YiPpkx7lkcMA8GA1Ud
EwEB/wQFMAMBAf8wGgYDVR0RBBMwEYIJbG9jYWxob3N0hwR/AAABMAoGCCqGSM49
BAMCA0kAMEYCIQCm9in9KPHO6HgJwN3vjRyAjQ6NWxAyNx86ONAweBMjFAIhAPdT
vijKow0/c43ELGnJwXrl/Edx4w45jDaSY89eRmgg
-----END CERTIFICATE-----`;

function service(subscriptionUrl, options = {}) {
  const stub = createPanelStub();
  const xui = new XuiService({
    panelUrl: 'https://panel.example.com:2053/secret/',
    username: 'admin',
    password: 'pw',
    subscriptionUrl,
    fetchImpl: stub.fetchImpl,
    cacheTtlSeconds: 0,
    ...options,
  });
  return { xui, stub };
}

test('subscription bodies are parsed without touching the URI text', () => {
  assert.deepEqual(parseSubscriptionBody(RAW_SUBSCRIPTION_TEXT), RAW_SUBSCRIPTION_LINES);
  assert.deepEqual(parseSubscriptionBody(RAW_SUBSCRIPTION_BASE64), RAW_SUBSCRIPTION_LINES);
  // CRLF and a trailing newline must not leak into the URIs.
  assert.deepEqual(parseSubscriptionBody(`${RAW_SUBSCRIPTION_TEXT}\r\n`), RAW_SUBSCRIPTION_LINES);
  assert.deepEqual(parseSubscriptionBody(''), []);
  assert.deepEqual(parseSubscriptionBody('<html>panel</html>'), []);
});

test('config metadata keeps the mDNS host, port and remark exactly', () => {
  const configs = parseSubscriptionConfigs(RAW_SUBSCRIPTION_TEXT);
  assert.equal(configs.length, 3);
  assert.equal(configs[0].uri, RAW_SUBSCRIPTION_LINES[0]);
  assert.equal(configs[0].remark, 'h77hew750g-mDNS');
  assert.ok(configs[0].uri.includes('@devops.mydomain.com:443?'));
  assert.equal(configs[0].protocol, 'vless');
  assert.equal(configs[0].network, 'ws');
  assert.equal(configs[0].security, 'tls');
  // The UI lower-cases protocol keys, so it must also upstream.
  assert.deepEqual(configs.map((c) => c.protocol), ['vless', 'vless', 'trojan']);
  assert.deepEqual(configs.map((c) => c.security), ['tls', 'tls', 'tls']);
});

test('getClientByToken uses the subscription service and never rebuilds URIs', async () => {
  const { xui, stub } = service('http://host.docker.internal:2096/sub');
  const client = await xui.getClientByToken('tokenalice01');

  assert.ok(client);
  assert.deepEqual(client.uris, RAW_SUBSCRIPTION_LINES);
  assert.deepEqual(client.configs.map((c) => c.uri), RAW_SUBSCRIPTION_LINES);
  assert.equal(client.vlessUri, RAW_SUBSCRIPTION_LINES[0]);
  // Usage/expiry still come from the panel API, not from the sub body.
  assert.equal(client.upload, 1500);
  assert.equal(client.download, 2500);
  assert.equal(client.email, 'alice@example.com');

  const subCalls = stub.state.calls.filter((call) => call.includes('/sub/'));
  assert.deepEqual(subCalls, ['GET http://host.docker.internal:2096/sub/tokenalice01']);
  assert.equal(stub.state.subscriptionHeaders['User-Agent'], 'v2rayNG/1.8.5');
  // No admin cookie is sent to the subscription port.
  assert.equal(stub.state.subscriptionHeaders.Cookie, undefined);
});

test('a Base64 subscription body is decoded and cached for the TTL', async () => {
  const xui = new XuiService({
    panelUrl: 'https://panel.example.com:2053/secret',
    username: 'admin',
    password: 'pw',
    subscriptionUrl: 'http://panel.example.com:2096/sub',
    fetchImpl: createPanelStub({ subscriptionBody: RAW_SUBSCRIPTION_BASE64 }).fetchImpl,
    cacheTtlSeconds: 60,
  });

  const first = await xui.getSubscriptionConfigs('tokenalice01');
  assert.deepEqual(first.map((c) => c.uri), RAW_SUBSCRIPTION_LINES);
  const second = await xui.getSubscriptionConfigs('tokenalice01');
  assert.equal(second, first, 'cached array is reused inside the TTL');
});

test('{subId} in XUI_SUB_URL replaces the trailing-path form', async () => {
  const { xui, stub } = service('http://panel.example.com:2096/sub/{subId}?format=raw');
  const client = await xui.getClientByToken('tokenalice01');
  assert.ok(client);
  assert.deepEqual(
    stub.state.calls.filter((call) => call.includes('/sub/')),
    ['GET http://panel.example.com:2096/sub/tokenalice01?format=raw'],
  );
});

test('unknown tokens never reach the subscription service', async () => {
  const { xui, stub } = service('http://panel.example.com:2096/sub');
  assert.equal(await xui.getClientByToken('unknown9999'), null);
  assert.equal(stub.state.calls.some((call) => call.includes('/sub/')), false);
});

test('a disabled client (empty body) is not reported as a broken subscription', async () => {
  const xui = new XuiService({
    panelUrl: 'https://panel.example.com:2053/secret',
    username: 'admin',
    password: 'pw',
    subscriptionUrl: 'http://panel.example.com:2096/sub',
    fetchImpl: createPanelStub({ subscriptionBody: '' }).fetchImpl,
    cacheTtlSeconds: 0,
  });

  const client = await xui.getClientByToken('tokenalice01');
  assert.ok(client, 'the client record still resolves from the panel API');
  assert.deepEqual(client.uris, []);
  assert.equal(client.vlessUri, null);
});

test('an HTML answer (wrong XUI_SUB_URL) fails loudly instead of silently', async () => {
  const stub = createPanelStub();
  const xui = new XuiService({
    panelUrl: 'https://panel.example.com:2053/secret',
    username: 'admin',
    password: 'pw',
    subscriptionUrl: 'http://panel.example.com:2096/wrong-sub',
    // The URL points at the panel UI, which answers with its login page.
    fetchImpl: async (url, options) => {
      if (String(url).includes('/wrong-sub/')) {
        return new Response('<html><body>login</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      return stub.fetchImpl(url, options);
    },
    cacheTtlSeconds: 0,
  });

  await assert.rejects(
    () => xui.getClientByToken('tokenalice01'),
    (error) => error instanceof XuiError && error.code === 'XUI_SUB_INVALID_BODY',
  );
});

test('an HTTP error from the subscription port surfaces as 502', async () => {
  const stub = createPanelStub();
  const xui = new XuiService({
    panelUrl: 'https://panel.example.com:2053/secret',
    username: 'admin',
    password: 'pw',
    subscriptionUrl: 'http://panel.example.com:2096/sub',
    fetchImpl: async (url, options) => {
      if (String(url).includes('/sub/')) return new Response('nope', { status: 500 });
      return stub.fetchImpl(url, options);
    },
    cacheTtlSeconds: 0,
  });

  await assert.rejects(
    () => xui.getClientByToken('tokenalice01'),
    (error) => error instanceof XuiError && error.status === 502 && error.code === 'XUI_SUB_HTTP_ERROR',
  );
});

test('only internal HTTPS hosts relax certificate verification', () => {
  for (const host of [
    'localhost',
    '127.0.0.1',
    '10.0.0.5',
    '192.168.1.10',
    '172.20.0.3',
    '100.64.1.5',
    'host.docker.internal',
    'xui',
    '[::1]',
  ]) {
    assert.equal(isInternalHost(host), true, `${host} must be internal`);
  }
  for (const host of ['panel.example.com', 'sub.example.com', '8.8.8.8', '172.32.0.1']) {
    assert.equal(isInternalHost(host), false, `${host} must be public`);
  }

  const internal = service('https://127.0.0.1:2096/sub').xui;
  assert.equal(internal.subscriptionTlsInsecure, true);
  const external = service('https://sub.example.com/sub').xui;
  assert.equal(external.subscriptionTlsInsecure, false);
  const plain = service('http://127.0.0.1:2096/sub').xui;
  assert.equal(plain.subscriptionTlsInsecure, false, 'http needs no agent');
});

test('a self-signed certificate on an internal HTTPS host is accepted', async () => {
  const server = https.createServer({ key: TLS_KEY, cert: TLS_CERT }, (req, res) => {
    if (req.url !== '/sub/tokenalice01') {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(RAW_SUBSCRIPTION_TEXT);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const xui = new XuiService({
      panelUrl: 'https://panel.example.com:2053/secret',
      username: 'admin',
      password: 'pw',
      subscriptionUrl: `https://127.0.0.1:${port}/sub`,
      fetchImpl: createPanelStub().fetchImpl,
      cacheTtlSeconds: 0,
    });

    const configs = await xui.getSubscriptionConfigs('tokenalice01');
    assert.deepEqual(configs.map((c) => c.uri), RAW_SUBSCRIPTION_LINES);
    assert.equal(configs[0].remark, 'h77hew750g-mDNS');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a public HTTPS host keeps verification even if the certificate is bad', async () => {
  // `localhost.` is not treated as an internal name, so the request goes through
  // fetch with full verification and must fail on the self-signed chain.
  const server = https.createServer({ key: TLS_KEY, cert: TLS_CERT }, (req, res) => {
    res.writeHead(200).end(RAW_SUBSCRIPTION_TEXT);
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const xui = new XuiService({
      panelUrl: 'https://panel.example.com:2053/secret',
      username: 'admin',
      password: 'pw',
      subscriptionUrl: `https://localhost.:${port}/sub`,
      // Real fetch: verification must not be skipped for a public host name.
      fetchImpl: globalThis.fetch,
      cacheTtlSeconds: 0,
    });
    assert.equal(xui.subscriptionTlsInsecure, false);
    await assert.rejects(
      () => xui.getSubscriptionConfigs('tokenalice01'),
      (error) => error instanceof XuiError && error.code === 'XUI_SUB_UNREACHABLE',
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
