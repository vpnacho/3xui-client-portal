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

test('traffic is counted once when the same client email is in multiple inbounds (dedup)', async () => {
  // 3 inbounds, each has the same email + subId with identical clientStats.
  // Before the fix, upload/download/total would each be multiplied by 3.
  const sharedStats = { email: '@VPNacho', up: 100, down: 200, total: 5 * GB, enable: true, expiryTime: 0 };
  const makeInbound = (id, protocol) => ({
    id,
    remark: `ib-${id}`,
    enable: true,
    protocol,
    listen: '0.0.0.0',
    port: 10000 + id,
    settings: JSON.stringify({
      clients: [{ id: `uuid-vn-${id}`, email: '@VPNacho', subId: 'tokenVPNacho' }],
    }),
    streamSettings: JSON.stringify({ network: 'tcp', security: 'none' }),
    clientStats: [{ ...sharedStats }],
  });

  const threeInbounds = [makeInbound(10, 'vless'), makeInbound(11, 'vless'), makeInbound(12, 'vless')];

  const xui = new XuiService({
    panelUrl: 'https://panel.example.com:2053/',
    username: 'admin',
    password: 'pw',
    cacheTtlSeconds: 0,
    fetchImpl: async (url, options = {}) => {
      const target = String(url);
      const method = options.method || 'GET';
      if (target.endsWith('/') && method === 'GET') {
        return new Response('<html></html>', {
          status: 200,
          headers: { 'set-cookie': 'session=pre; Path=/', 'content-type': 'text/html' },
        });
      }
      if (target.endsWith('/login')) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'set-cookie': '3x-ui=ok; Path=/', 'content-type': 'application/json' },
        });
      }
      if (target.endsWith('/panel/api/inbounds/list')) {
        return new Response(JSON.stringify({ success: true, obj: threeInbounds }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: false }), { status: 404, headers: { 'content-type': 'application/json' } });
    },
  });

  const client = await xui.getClientByToken('tokenVPNacho');
  assert.ok(client, 'client must be found');
  assert.equal(client.email, '@VPNacho');
  // Stats must NOT be multiplied by 3 — deduplication by email keeps only one entry.
  assert.equal(client.upload, 100, `upload should be 100 not ${client.upload}`);
  assert.equal(client.download, 200, `download should be 200 not ${client.download}`);
  assert.equal(client.total, 5 * GB, `total should be 5 GB not ${client.total}`);
});

test('distinct emails sharing a subId across inbounds are still aggregated', async () => {
  // Two different emails sharing the same subId — both traffic lines must be summed.
  const makeMultiInbound = (id, email, up, down, total) => ({
    id,
    remark: `ib-multi-${id}`,
    enable: true,
    protocol: 'vless',
    listen: '0.0.0.0',
    port: 20000 + id,
    settings: JSON.stringify({
      clients: [{ id: `uuid-m-${id}`, email, subId: 'tokenMulti01' }],
    }),
    streamSettings: JSON.stringify({ network: 'tcp', security: 'none' }),
    clientStats: [{ email, up, down, total, enable: true, expiryTime: 0 }],
  });

  const multiInbounds = [
    makeMultiInbound(20, 'alpha@example.com', 300, 400, 10 * GB),
    makeMultiInbound(21, 'beta@example.com', 100, 200, 5 * GB),
  ];

  const xui = new XuiService({
    panelUrl: 'https://panel.example.com:2053/',
    username: 'admin',
    password: 'pw',
    cacheTtlSeconds: 0,
    fetchImpl: async (url, options = {}) => {
      const target = String(url);
      const method = options.method || 'GET';
      if (target.endsWith('/') && method === 'GET') {
        return new Response('<html></html>', {
          status: 200,
          headers: { 'set-cookie': 'session=pre; Path=/', 'content-type': 'text/html' },
        });
      }
      if (target.endsWith('/login')) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'set-cookie': '3x-ui=ok; Path=/', 'content-type': 'application/json' },
        });
      }
      if (target.endsWith('/panel/api/inbounds/list')) {
        return new Response(JSON.stringify({ success: true, obj: multiInbounds }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: false }), { status: 404, headers: { 'content-type': 'application/json' } });
    },
  });

  const client = await xui.getClientByToken('tokenMulti01');
  assert.ok(client, 'client must be found');
  // Both distinct emails are aggregated.
  assert.equal(client.upload, 400, `upload should be 300+100=400 not ${client.upload}`);
  assert.equal(client.download, 600, `download should be 400+200=600 not ${client.download}`);
  assert.equal(client.total, 15 * GB, `total should be 10+5=15 GB not ${client.total}`);
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

// ---- Endpoint fallback tests (Task 1) ----------------------------------------

/**
 * Build a minimal fetch stub that only exposes the npmplus-style
 * /panel/api/clients/* routes, returning 404 for the standard
 * /panel/api/inbounds/* online and clientIps endpoints.
 */
function makeClientsOnlyFetchImpl({ onlineEmails = ['@VPNacho'], ips = [] } = {}) {
  const calledPaths = [];
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    const method = options.method || 'GET';
    calledPaths.push(`${method} ${target}`);

    if (target.endsWith('/') && method === 'GET') {
      return new Response('<html></html>', {
        status: 200,
        headers: { 'set-cookie': 'session=pre; Path=/', 'content-type': 'text/html' },
      });
    }
    if (target.endsWith('/login')) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'set-cookie': '3x-ui=ok; Path=/', 'content-type': 'application/json' },
      });
    }
    if (target.endsWith('/panel/api/inbounds/list')) {
      return new Response(JSON.stringify({ success: true, obj: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    // Standard inbounds routes return 404 (panel does not expose them).
    if (target.endsWith('/panel/api/inbounds/onlines')) {
      return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
    }
    if (target.includes('/panel/api/inbounds/clientIps/')) {
      return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
    }
    // Clients routes return the configured data.
    if (target.endsWith('/panel/api/clients/onlines')) {
      return new Response(JSON.stringify({ success: true, obj: onlineEmails }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (target.includes('/panel/api/clients/ips/')) {
      return new Response(JSON.stringify({ success: true, obj: ips }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ success: false }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetchImpl, calledPaths };
}

function makeClientsOnlyService(options = {}) {
  const stub = makeClientsOnlyFetchImpl(options);
  const xui = new XuiService({
    panelUrl: 'https://panel.example.com:2053/',
    username: 'admin',
    password: 'pw',
    cacheTtlSeconds: 0,
    fetchImpl: stub.fetchImpl,
  });
  return { xui, calledPaths: stub.calledPaths };
}

test('fallback: getOnlineEmails falls back to /clients/onlines when /inbounds/onlines returns 404', async () => {
  const { xui, calledPaths } = makeClientsOnlyService({ onlineEmails: ['@VPNacho'] });

  const emails = await xui.getOnlineEmails();
  assert.ok(emails.has('@VPNacho'), 'must include the online email from clients/onlines');

  // The standard route was tried first and returned 404.
  assert.ok(
    calledPaths.some((p) => p.includes('/panel/api/inbounds/onlines')),
    'must have tried inbounds/onlines first',
  );
  assert.ok(
    calledPaths.some((p) => p.includes('/panel/api/clients/onlines')),
    'must have fallen back to clients/onlines',
  );
  // Confirm the working path is cached.
  assert.equal(xui._onlineApiPath, '/panel/api/clients/onlines');
});

test('fallback: second getOnlineEmails call uses cached path without re-probing /inbounds/onlines', async () => {
  const { xui, calledPaths } = makeClientsOnlyService({ onlineEmails: ['@VPNacho'] });

  // First call: probes both.
  await xui.getOnlineEmails();
  const firstLength = calledPaths.length;

  // Force cache expiry.
  if (xui.onlineCache) xui.onlineCache.expiresAt = 0;

  // Second call: must only hit clients/onlines, not inbounds/onlines.
  await xui.getOnlineEmails();
  const newCalls = calledPaths.slice(firstLength);

  assert.ok(
    !newCalls.some((p) => p.includes('/panel/api/inbounds/onlines')),
    'must not re-probe inbounds/onlines after the working path is cached',
  );
  assert.ok(
    newCalls.some((p) => p.includes('/panel/api/clients/onlines')),
    'must use cached clients/onlines path',
  );
});

test('fallback: getClientIps falls back to /clients/ips/:email on 404 (including URL-encoded email)', async () => {
  const ips = ['109.109.45.139', '2.145.14.184'];
  const { xui, calledPaths } = makeClientsOnlyService({ ips });

  const result = await xui.getClientIps('@VPNacho');
  assert.deepEqual(result.sort(), ips.sort());

  const encodedEmail = encodeURIComponent('@VPNacho');
  assert.ok(
    calledPaths.some((p) => p.includes(`/panel/api/inbounds/clientIps/${encodedEmail}`)),
    'must have tried inbounds/clientIps first',
  );
  assert.ok(
    calledPaths.some((p) => p.includes(`/panel/api/clients/ips/${encodedEmail}`)),
    'must have fallen back to clients/ips',
  );
  assert.equal(xui._ipsApiPrefix, '/panel/api/clients/ips');
});

test('fallback: second getClientIps call uses cached prefix without re-probing /inbounds/clientIps', async () => {
  const ips = ['1.2.3.4'];
  const { xui, calledPaths } = makeClientsOnlyService({ ips });

  await xui.getClientIps('@VPNacho');
  const firstLength = calledPaths.length;

  // Expire the IP cache.
  xui.ipCache.delete('@VPNacho');

  await xui.getClientIps('@VPNacho');
  const newCalls = calledPaths.slice(firstLength);

  assert.ok(
    !newCalls.some((p) => p.includes('/panel/api/inbounds/clientIps/')),
    'must not re-probe inbounds/clientIps after the working prefix is cached',
  );
  assert.ok(
    newCalls.some((p) => p.includes('/panel/api/clients/ips/')),
    'must reuse clients/ips prefix',
  );
});

// ---- Object-array IP payload tests (Task 2) -----------------------------------

test('getClientIps handles object-array IP payload [{ ip, time, node }] from /clients/ips', async () => {
  // Build 85 unique IPs as the object-array format the new endpoint returns.
  const baseIps = Array.from({ length: 85 }, (_, i) => `10.${Math.floor(i / 256)}.${i % 256}.1`);
  const objectArrayPayload = baseIps.map((ip, i) => ({
    ip,
    time: `2026-11-21 17:0${i % 60 < 10 ? '0' : ''}${i % 60}:00`,
    node: '',
  }));

  const { xui } = makeClientsOnlyService({ ips: objectArrayPayload });
  const result = await xui.getClientIps('@VPNacho');

  assert.equal(result.length, 85, `expected 85 IPs, got ${result.length}`);
  // All entries must be plain IP strings, not objects.
  assert.ok(result.every((e) => typeof e === 'string'), 'each entry must be a string IP');
});

test('object-array IP payload is correctly summarized: connections count, no raw IPs leaked', async () => {
  const { summarizeCountries } = require('../geo');

  const objectPayload = [
    { ip: '8.8.8.8', time: '2026-11-21 17:01:32', node: '' },
    { ip: '8.8.4.4', time: '2026-11-21 17:01:33', node: '' },
    { ip: '1.1.1.1', time: '2026-11-21 17:01:34', node: '' },
    { ip: '8.8.8.8', time: '2026-11-21 17:01:35', node: '' }, // duplicate
  ];

  const summary = summarizeCountries(objectPayload);
  // 3 unique IPs (8.8.8.8 is deduplicated).
  assert.equal(summary.connections, 3, `expected 3 unique IPs, got ${summary.connections}`);
  assert.ok(Array.isArray(summary.countries));
  // No raw IP addresses in the output keys.
  assert.deepEqual(
    Object.keys(summary).sort(),
    ['connections', 'countries'],
    'output must not contain a raw IP field',
  );
  // No IP-shaped strings in country names.
  assert.ok(
    summary.countries.every((c) => !/\d{1,3}\.\d{1,3}\.\d{1,3}/.test(c.name)),
    'country names must not contain IP addresses',
  );
});

test('object-array with 80+ entries is processed accurately (no truncation)', async () => {
  const { summarizeCountries } = require('../geo');

  // 92 distinct IPs from various ranges.
  const payload = Array.from({ length: 92 }, (_, i) => ({
    ip: `2.145.${Math.floor(i / 256)}.${i % 256}`,
    time: '2026-11-21 17:01:06',
    node: '',
  }));

  const summary = summarizeCountries(payload);
  assert.equal(summary.connections, 92, `expected 92, got ${summary.connections}`);
});

test('isClientOnline uses case-insensitive comparison', async () => {
  // Panel returns lowercase email; we query with the casing stored in the client record.
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    const method = options.method || 'GET';
    if (target.endsWith('/') && method === 'GET') {
      return new Response('<html></html>', {
        status: 200,
        headers: { 'set-cookie': 's=1; Path=/' },
      });
    }
    if (target.endsWith('/login')) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'set-cookie': '3x-ui=s; Path=/', 'content-type': 'application/json' },
      });
    }
    if (target.endsWith('/panel/api/inbounds/onlines')) {
      // Panel returns all-lowercase.
      return new Response(JSON.stringify({ success: true, obj: ['alice@example.com'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ success: true, obj: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const xui = new XuiService({
    panelUrl: 'https://panel.example.com',
    username: 'a',
    password: 'b',
    cacheTtlSeconds: 0,
    fetchImpl,
  });

  assert.equal(await xui.isClientOnline('alice@example.com'), true, 'exact case matches');
  xui.onlineCache.expiresAt = 0; // expire cache between checks
  assert.equal(await xui.isClientOnline('Alice@Example.COM'), true, 'case-insensitive match');
  xui.onlineCache.expiresAt = 0;
  assert.equal(await xui.isClientOnline('bob@example.com'), false, 'different user is offline');
});
