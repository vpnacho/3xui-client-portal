'use strict';

const GB = 1024 ** 3;

/**
 * Raw body of the panel's own Subscription service for `tokenalice01`.
 *
 * `RAW_SUBSCRIPTION_LINES` is the order the panel emits; `RAW_SUBSCRIPTION_TEXT`
 * is what `/sub/:token` must Base64-encode unchanged. The mDNS line keeps the
 * public host/port, the panel's query order and `#h77hew750g-mDNS` verbatim so a
 * rewrite anywhere in the pipeline is caught.
 */
const RAW_SUBSCRIPTION_LINES = [
  'vless://45faf5f9-7bb5-4b7f-82e8-a7b0321014bb@devops.mydomain.com:443?type=ws&security=tls&encryption=none&fp=chrome&sni=devops.mydomain.com&path=%2FbxOvaPi&host=devops.mydomain.com#h77hew750g-mDNS',
  'vless://uuid-a@edge.example.com:8443?type=ws&security=tls&encryption=none&fp=chrome&sni=de.example.com&path=%2Fws&host=de.example.com#alice%40example.com-CDN',
  'trojan://secret@panel.example.com:2087?type=grpc&security=tls&sni=nl.example.com&serviceName=grpcsvc#NL-Amsterdam',
];
const RAW_SUBSCRIPTION_TEXT = RAW_SUBSCRIPTION_LINES.join('\n');

/** Same lines, exactly as 3x-ui sends them when Base64 is requested. */
const RAW_SUBSCRIPTION_BASE64 = Buffer.from(RAW_SUBSCRIPTION_TEXT, 'utf8').toString('base64');

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
          { dest: 'edge.example.com', port: 8443, remark: 'CDN', forceTls: 'same' },
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
function createPanelStub({
  csrfToken = 'csrf-abc-123',
  /**
   * `XUI_SUB_URL` surface: absent means the portal must build URIs locally
   * (the existing tests), a string/base64 value serves it as a raw
   * subscription body. Set `subscriptionBody: ''` for the panel's
   * "client disabled" answer (HTTP 200, empty body).
   */
  subscriptionBody = RAW_SUBSCRIPTION_TEXT,
} = {}) {
  const state = { calls: [], csrfHeader: '', formBody: '', loginBodies: [] };

  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    const method = options.method || 'GET';
    state.calls.push(`${method} ${target}`);

    if (target.includes('/sub/')) {
      const { pathname } = new URL(target);
      // Only `tokenalice01` has a subscription, like the real panel.
      if (!pathname.endsWith('/sub/tokenalice01')) {
        return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
      }
      state.subscriptionCalls = (state.subscriptionCalls || 0) + 1;
      state.subscriptionHeaders = options.headers || {};
      return new Response(subscriptionBody, {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

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

module.exports = {
  GB,
  inbounds,
  json,
  createPanelStub,
  RAW_SUBSCRIPTION_LINES,
  RAW_SUBSCRIPTION_TEXT,
  RAW_SUBSCRIPTION_BASE64,
};
