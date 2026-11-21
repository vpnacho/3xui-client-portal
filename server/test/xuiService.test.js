'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  XuiService,
  buildVlessConfigs,
  extractCsrfToken,
  resolveEndpoint,
  splitHostPort,
} = require('../xuiService');
const { GB, createPanelStub } = require('./fixtures');

function service(options = {}) {
  const stub = createPanelStub();
  const xui = new XuiService({
    panelUrl: 'https://panel.example.com:2053/secret/',
    username: 'admin',
    password: 'pw',
    fetchImpl: stub.fetchImpl,
    cacheTtlSeconds: 0,
    ...options,
  });
  return { xui, stub };
}

test('login fetches the page first for the cookie and the CSRF token', async () => {
  const { xui, stub } = service();
  await xui.listInbounds();

  assert.equal(stub.state.calls[0], 'GET https://panel.example.com:2053/secret/');
  assert.match(stub.state.calls[1], /^POST https:\/\/panel\.example\.com:2053\/secret\/login$/);
  assert.equal(stub.state.csrfHeader, 'csrf-abc-123', 'token sent as X-CSRF-Token');
  assert.ok(stub.state.loginBodies[0].includes('csrf-abc-123'), 'token sent in the body');
  assert.ok(
    stub.state.calls.some((call) => call.endsWith('/panel/api/inbounds/list')),
    'inbounds fetched after login',
  );
});

test('extractCsrfToken reads meta tags and ignores junk', () => {
  assert.equal(extractCsrfToken('<meta name="csrf-token" content="zz">'), 'zz');
  assert.equal(extractCsrfToken('<meta content="q" name="csrf-token">'), 'q');
  assert.equal(extractCsrfToken('<input name="_csrf" value="abc">'), 'abc');
  assert.equal(extractCsrfToken('no token here'), '');
  assert.equal(extractCsrfToken(null), '');
});

test('splitHostPort handles hostnames, ports, URLs and IPv6', () => {
  assert.deepEqual(splitHostPort('edge.example.com'), { host: 'edge.example.com', port: 0 });
  assert.deepEqual(splitHostPort('edge.example.com:8443'), { host: 'edge.example.com', port: 8443 });
  assert.deepEqual(splitHostPort('https://edge.example.com:9443/x'), {
    host: 'edge.example.com',
    port: 9443,
  });
  assert.deepEqual(splitHostPort('[2001:db8::1]:443'), { host: '2001:db8::1', port: 443 });
});

test('resolveEndpoint prefers externalProxy and reads the panel, never an override', () => {
  const inbound = {
    listen: '0.0.0.0',
    port: 443,
    streamSettings: JSON.stringify({
      externalProxy: [{ dest: 'edge.example.com', port: 8443 }],
    }),
  };
  assert.deepEqual(resolveEndpoint(inbound, 'panel.example.com'), {
    host: 'edge.example.com',
    port: 8443,
    external: { dest: 'edge.example.com', port: 8443 },
  });

  const wildcard = { listen: '0.0.0.0', port: 2087, streamSettings: '{}' };
  assert.equal(resolveEndpoint(wildcard, 'panel.example.com').host, 'panel.example.com');
  assert.equal(resolveEndpoint(wildcard, 'panel.example.com').port, 2087);

  const explicit = { listen: '1.2.3.4', port: 2053, streamSettings: '{}' };
  assert.equal(resolveEndpoint(explicit, 'panel.example.com').host, '1.2.3.4');
});

test('getClientByToken aggregates every matching inbound in bytes', async () => {
  const { xui } = service();
  const client = await xui.getClientByToken('tokenalice01');

  assert.ok(client);
  assert.equal(client.email, 'alice@example.com');
  assert.equal(client.upload, 1500);
  assert.equal(client.download, 2500);
  assert.equal(client.total, 15 * GB, 'stats.total summed as-is, never multiplied');
  assert.equal(client.configs.length, 2, 'all enabled inbounds are scanned');
  assert.deepEqual(client.configs.map((c) => c.protocol).sort(), ['trojan', 'vless']);
  assert.equal(client.uris.length, 2);
  assert.equal(client.expiryTime, 1893456000000);
});

test('a 5 GB plan is reported as 5 GB (regression: exabyte bug)', async () => {
  const { xui } = service();
  const client = await xui.getClientByToken('tokencarol01');
  // carol has total 0 -> unlimited
  assert.equal(client.total, 0);

  const stub = createPanelStub();
  const single = new XuiService({
    panelUrl: 'https://panel.example.com',
    username: 'a',
    password: 'b',
    fetchImpl: async (url, options) => {
      if (String(url).endsWith('/panel/api/inbounds/list')) {
        return stub.fetchImpl('https://panel.example.com/panel/api/inbounds/list', options);
      }
      return stub.fetchImpl(url, options);
    },
    cacheTtlSeconds: 0,
  });
  const alice = await single.getClientByToken('tokenalice01');
  assert.equal(alice.total / GB, 15);
  assert.equal(alice.total < 1024 ** 6, true, 'never reaches petabyte scale');
});

test('config entries expose remark, protocol, network, security and uri', async () => {
  const { xui } = service();
  const client = await xui.getClientByToken('tokenalice01');
  const vless = client.configs.find((c) => c.protocol === 'vless');
  const trojan = client.configs.find((c) => c.protocol === 'trojan');

  assert.deepEqual(Object.keys(vless).sort(), [
    'email',
    'host',
    'network',
    'port',
    'protocol',
    'remark',
    'security',
    'uri',
  ]);
  assert.equal(vless.remark, 'alice@example.com-CDN');
  assert.equal(vless.email, 'alice@example.com');
  assert.equal(vless.network, 'ws');
  assert.equal(vless.security, 'tls');
  assert.equal(vless.host, 'edge.example.com');
  assert.equal(vless.port, 8443);

  assert.ok(vless.uri.startsWith('vless://uuid-a@edge.example.com:8443?'), vless.uri);
  assert.ok(vless.uri.includes('sni=de.example.com'), 'tlsSettings.serverName wins over the proxy');
  assert.ok(vless.uri.includes('path=%2Fws'));
  assert.ok(vless.uri.includes('host=de.example.com'));
  assert.ok(vless.uri.includes('fp=chrome'), 'TLS fingerprint defaults to chrome');
  assert.ok(vless.uri.endsWith('#alice%40example.com-CDN'), vless.uri);

  assert.ok(trojan.uri.startsWith('trojan://secret@panel.example.com:2087?'), trojan.uri);
  assert.ok(trojan.uri.includes('serviceName=grpcsvc'));
  assert.ok(trojan.uri.endsWith('#NL-Amsterdam'));
});

test('vmess config is base64 JSON built from the panel listen address', async () => {
  const { xui } = service();
  const client = await xui.getClientByToken('tokencarol01');
  const [config] = client.configs;

  assert.ok(config.uri.startsWith('vmess://'));
  const payload = JSON.parse(Buffer.from(config.uri.slice(8), 'base64').toString('utf8'));
  assert.equal(payload.add, '1.2.3.4');
  assert.equal(payload.port, '2053');
  assert.equal(payload.ps, 'US-NewYork');
  assert.equal(payload.v, '2');
});

test('WS inbound with externalProxy matches the panel subscription URI exactly', () => {
  const client = {
    id: '45faf5f9-7bb5-4b7f-82e8-a7b0321014bb',
    email: 'h77hew750g',
  };
  const inbound = {
    remark: '',
    listen: '0.0.0.0',
    port: 53920,
    protocol: 'vless',
    streamSettings: {
      network: 'ws',
      security: 'none',
      wsSettings: { path: '/bxOvaPi', headers: {} },
      tlsSettings: {},
      externalProxy: [
        {
          dest: 'devops.mydomain.com',
          port: 443,
          forceTls: 'tls',
          remark: 'mDNS',
        },
      ],
    },
  };

  const configs = buildVlessConfigs(client, inbound, 'panel.example.com');
  assert.equal(configs.length, 1);
  assert.equal(
    configs[0].uri,
    'vless://45faf5f9-7bb5-4b7f-82e8-a7b0321014bb@devops.mydomain.com:443?type=ws&security=tls&encryption=none&fp=chrome&sni=devops.mydomain.com&path=%2FbxOvaPi&host=devops.mydomain.com#h77hew750g-mDNS',
  );
  assert.equal(configs[0].remark, 'h77hew750g-mDNS');
  assert.equal(configs[0].host, 'devops.mydomain.com');
  assert.equal(configs[0].port, 443);
  assert.equal(configs[0].security, 'tls');
});

test('disabled inbounds and unknown tokens resolve to null', async () => {
  const { xui } = service();
  const client = await xui.getClientByToken('tokenalice01');
  assert.ok(!client.configs.some((c) => c.remark === 'disabled-inbound'));

  assert.equal(await xui.getClientByToken('unknown-token-1'), null);
  assert.equal(await xui.getClientByToken(''), null);
  assert.equal(await xui.getClientByToken('x'.repeat(200)), null);
  assert.equal(await xui.getClientByToken(null), null);
});

test('malformed tokens are rejected before the panel is contacted', async () => {
  const { xui, stub } = service();
  const bad = [
    ' tokenalice01',
    'tokenalice01 ',
    'token alice01',
    'token\talice01',
    'token\nalice01',
    'alice@example.com',
    'tokenalice01!',
    'token+plus01',
    'ok123',
    'x'.repeat(65),
    '',
    null,
    42,
  ];
  for (const token of bad) {
    assert.equal(await xui.getClientByToken(token), null, `rejected: ${JSON.stringify(token)}`);
  }
  assert.equal(stub.state.calls.length, 0, 'invalid tokens never reach the panel');

  // A valid token in the exact same shape as above still resolves.
  assert.ok(await xui.getClientByToken('tokenalice01'));
});

test('exact subId matches; emails and UUIDs are never lookup keys', async () => {
  const { xui } = service();
  assert.ok(await xui.getClientByToken('tokenalice01'), 'valid subId succeeds');
  assert.equal(await xui.getClientByToken('alice@example.com'), null, 'email rejected');
  assert.equal(await xui.getClientByToken('bob@example.com'), null, 'other email rejected');
  assert.equal(await xui.getClientByToken('uuid-a'), null, 'UUID not a lookup key');
});

test('online state is read from the onlines endpoint', async () => {
  const { xui } = service();
  assert.equal(await xui.isClientOnline('alice@example.com'), true);
  assert.equal(await xui.isClientOnline('bob@example.com'), false);
  assert.equal(await xui.isClientOnline(''), false);
});

test('a failing IP log degrades to an empty list', async () => {
  const xui = new XuiService({
    panelUrl: 'https://panel.example.com',
    username: 'a',
    password: 'b',
    cacheTtlSeconds: 0,
    fetchImpl: async (url, options = {}) => {
      if (String(url).endsWith('/') && (options.method || 'GET') === 'GET') {
        return new Response('<html></html>', {
          status: 200,
          headers: { 'set-cookie': 's=1; Path=/' },
        });
      }
      if (String(url).endsWith('/login')) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'set-cookie': '3x-ui=s; Path=/', 'content-type': 'application/json' },
        });
      }
      if (String(url).includes('/clientIps/')) {
        return new Response(JSON.stringify({ success: false, msg: 'n/a' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true, obj: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  assert.deepEqual(await xui.getClientIps('alice@example.com'), []);
});
