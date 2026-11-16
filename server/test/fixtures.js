'use strict';

const GB = 1024 ** 3;

/** Panel-shaped inbound list: two enabled inbounds, one disabled. */
function inbounds() {
  return [
    {
      id: 1,
      remark: 'DE-Frankfurt',
      enable: true,
      protocol: 'vless',
      listen: '0.0.0.0',
      port: 443,
      settings: JSON.stringify({
        clients: [
          {
            id: 'uuid-a',
            email: 'alice@example.com',
            subId: 'tokenalice01',
            enable: true,
            flow: 'xtls-rprx-vision',
          },
          { id: 'uuid-b', email: 'bob@example.com', subId: 'tokenbob0001', enable: true },
        ],
      }),
      streamSettings: JSON.stringify({
        network: 'ws',
        security: 'tls',
        tlsSettings: { serverName: 'de.example.com' },
        wsSettings: { path: '/ws', headers: { Host: 'de.example.com' } },
        externalProxy: [
          { dest: 'edge.example.com', port: 8443, remark: 'CDN', sni: 'sni.example.com' },
        ],
      }),
      clientStats: [
        {
          email: 'alice@example.com',
          up: 1000,
          down: 2000,
          total: 5 * GB,
          enable: true,
          expiryTime: 1893456000000,
        },
      ],
    },
    {
      id: 2,
      remark: 'NL-Amsterdam',
      enable: true,
      protocol: 'trojan',
      listen: '0.0.0.0',
      port: 2087,
      settings: JSON.stringify({
        clients: [
          { password: 'secret', email: 'alice@example.com', subId: 'tokenalice01', enable: true },
        ],
      }),
      streamSettings: JSON.stringify({
        network: 'grpc',
        security: 'tls',
        tlsSettings: { serverName: 'nl.example.com' },
        grpcSettings: { serviceName: 'grpcsvc' },
      }),
      clientStats: [
        {
          email: 'alice@example.com',
          up: 500,
          down: 500,
          total: 10 * GB,
          enable: true,
          expiryTime: 1893456000000,
        },
      ],
    },
    {
      id: 3,
      remark: 'disabled-inbound',
      enable: false,
      protocol: 'vless',
      listen: '0.0.0.0',
      port: 9999,
      settings: JSON.stringify({
        clients: [{ id: 'uuid-disabled', email: 'alice@example.com', subId: 'tokenalice01' }],
      }),
      streamSettings: '{}',
      clientStats: [],
    },
    {
      id: 4,
      remark: 'US-NewYork',
      enable: true,
      protocol: 'vmess',
      listen: '1.2.3.4',
      port: 2053,
      settings: JSON.stringify({
        clients: [
          { id: 'uuid-c', email: 'carol@example.com', subId: 'tokencarol01', enable: true },
        ],
      }),
      streamSettings: JSON.stringify({ network: 'tcp', security: 'none' }),
      clientStats: [
        { email: 'carol@example.com', up: 10, down: 20, total: 0, enable: true, expiryTime: 0 },
      ],
    },
  ];
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/**
 * Stub of the 3x-ui HTTP surface. Records every call so tests can assert that
 * the login flow really fetches the page (cookie + CSRF) before POSTing.
 */
function createPanelStub({ csrfToken = 'csrf-abc-123' } = {}) {
  const state = { calls: [], csrfHeader: '', formBody: '', loginBodies: [] };

  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    const method = options.method || 'GET';
    state.calls.push(`${method} ${target}`);

    if (target.endsWith('/') && method === 'GET') {
      const meta = csrfToken ? `<meta name="csrf-token" content="${csrfToken}">` : '';
      return new Response(`<html><head>${meta}</head></html>`, {
        status: 200,
        headers: { 'set-cookie': 'session=pre; Path=/; HttpOnly', 'content-type': 'text/html' },
      });
    }
    if (target.endsWith('/login')) {
      state.csrfHeader = String(options.headers?.['X-CSRF-Token'] || '');
      const body = String(options.body || '');
      state.loginBodies.push(body);
      if (csrfToken && !body.includes(csrfToken)) return json({ success: false }, 403);
      return json({ success: true }, 200, { 'set-cookie': '3x-ui=session-ok; Path=/' });
    }
    if (target.endsWith('/panel/api/inbounds/list')) return json({ success: true, obj: inbounds() });
    if (target.endsWith('/panel/api/inbounds/onlines')) {
      return json({ success: true, obj: ['alice@example.com'] });
    }
    if (target.includes('/panel/api/inbounds/clientIps/')) {
      return json({
        success: true,
        obj: ['8.8.8.8', '1.1.1.1', '8.8.8.8', '185.4.4.4:443', '[2001:4860:4860::8888]:443'],
      });
    }
    return json({ success: false }, 404);
  };

  return { fetchImpl, state };
}

module.exports = { GB, inbounds, json, createPanelStub };
