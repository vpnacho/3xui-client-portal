'use strict';

const https = require('node:https');

/**
 * Minimal, read-only client for the 3x-ui (MHSanaei) panel API.
 *
 * Responsibilities:
 *   - keep an authenticated cookie in memory and renew it on 401/403
 *   - fetch the session cookie + CSRF token from the login page before
 *     `POST /login`, otherwise 3x-ui answers 403
 *   - list inbounds with a short TTL cache
 *   - resolve *every* config matching a `subId` across all enabled inbounds
 *   - build connection URIs straight from the panel data (no address rewriting)
 *   - report online state and the countries of connected IPs; raw IPs never
 *     leave this process
 *
 * The service never exposes panel credentials or data of other clients.
 */

const DEFAULT_TIMEOUT_MS = 10_000;
/**
 * A subscription token must be an exact panel `subId`: letters, digits, dash
 * and underscore, 6-64 chars. Emails (`@`), whitespace and anything else are
 * rejected before the panel is contacted, so lookups by email or UUID are
 * impossible by construction.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

/** Strict token check shared by the service and the HTTP layer. */
function isValidSubscriptionToken(token) {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}
const ONLINE_TTL_MS = 10_000;
const IP_CACHE_TTL_MS = 30_000;
const MAX_IP_CACHE_ENTRIES = 500;
const MAX_SUB_CACHE_ENTRIES = 200;
/** v2rayNG is what makes 3x-ui answer with the raw subscription body. */
const SUBSCRIPTION_USER_AGENT = 'v2rayNG/1.8.5';
/**
 * Any `scheme://` line is a config line. Matching the shape instead of a fixed
 * scheme list keeps future panel protocols (tuic, hysteria2, ...) working.
 */
const URI_PREFIX = /^[a-z][a-z0-9+.-]*:\/\//i;
/** `XUI_SUB_URL` may contain `{subId}` / `{token}` instead of a trailing path. */
const SUBSCRIPTION_PLACEHOLDER = /\{(?:subId|token)\}/i;

class XuiError extends Error {
  constructor(message, { status = 502, code = 'XUI_ERROR', cause } = {}) {
    super(message, { cause });
    this.name = 'XuiError';
    this.status = status;
    this.code = code;
  }
}

/** Parse a JSON field coming from the panel; tolerate missing/invalid values. */
function parseJsonField(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || value.trim() === '') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Timestamps in 3x-ui are milliseconds; treat anything smaller as seconds. */
function normalizeEpochMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return number < 1e12 ? Math.round(number * 1000) : Math.round(number);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const found = value.find((item) => typeof item === 'string' && item !== '');
      if (found) return found;
    } else if (typeof value === 'string' && value.trim() !== '') {
      return value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return '';
}

function hostForUri(host) {
  if (!host) return '';
  const value = String(host).trim();
  if (value.includes(':') && !value.startsWith('[')) return `[${value}]`;
  return value;
}

/** Split `example.com:8443` / `https://example.com/path` into host + optional port. */
function splitHostPort(raw) {
  let value = String(raw ?? '').trim();
  if (!value) return { host: '', port: 0 };

  if (value.includes('://')) {
    try {
      const url = new URL(value);
      return { host: url.hostname, port: Number(url.port) || 0 };
    } catch {
      value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('/')[0];
    }
  } else {
    value = value.split('/')[0];
  }

  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    const host = value.slice(1, end);
    const rest = value.slice(end + 1);
    return { host, port: rest.startsWith(':') ? Number(rest.slice(1)) || 0 : 0 };
  }

  const colons = (value.match(/:/g) || []).length;
  if (colons === 1) {
    const index = value.lastIndexOf(':');
    const host = value.slice(0, index);
    const port = Number(value.slice(index + 1));
    return { host, port: Number.isFinite(port) && port > 0 ? port : 0 };
  }
  return { host: value, port: 0 };
}

function normalizeBaseUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const url = new URL(value);
  // Query strings are kept: some subscription ports need `?format=raw`.
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
}

/** Extract the anti-CSRF token from the rendered 3x-ui login page. */
function extractCsrfToken(html) {
  if (typeof html !== 'string' || html === '') return '';
  const patterns = [
    /<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']csrf-token["']/i,
    /<input[^>]+name=["']_csrf["'][^>]+value=["']([^"']+)["']/i,
    /<input[^>]+value=["']([^"']+)["'][^>]+name=["']_csrf["']/i,
    /csrfToken\s*[:=]\s*["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) return match[1].trim();
  }
  return '';
}

function streamOf(inbound) {
  return inbound.streamSettings && typeof inbound.streamSettings === 'object'
    ? inbound.streamSettings
    : parseJsonField(inbound.streamSettings);
}

/**
 * `streamSettings.externalProxy` arrives either as an array or as a JSON
 * string; normalize it to a list of usable entries.
 */
function externalProxyList(inbound) {
  const stream = streamOf(inbound);
  const parsed = parseJsonField(stream.externalProxy);
  const list = Array.isArray(parsed) ? parsed : [];
  return list.filter(
    (item) =>
      item &&
      typeof item === 'object' &&
      (item.dest || item.port || item.remark || item.forceTls),
  );
}

function firstExternalProxy(inbound) {
  return externalProxyList(inbound)[0] || null;
}

/** Direct listener host; a wildcard/loopback listener falls back to the panel. */
function resolveDirectHost(inbound, panelHost) {
  const listen = String(inbound.listen || '').trim();
  const wildcard =
    listen === '' ||
    listen === '0.0.0.0' ||
    listen === '::' ||
    listen === '::0' ||
    listen === 'localhost' ||
    listen.startsWith('127.');
  return wildcard ? panelHost : splitHostPort(listen).host || panelHost;
}

/**
 * Connection endpoint, read straight from the panel: `externalProxy` (dest and
 * port) when the inbound defines one, otherwise the inbound listener. A
 * wildcard/loopback listener falls back to the panel host, because that is the
 * only address guaranteed to be reachable.
 */
function resolveEndpoint(inbound, panelHost) {
  const external = firstExternalProxy(inbound);
  const externalAddress = splitHostPort(external?.dest);

  let host = externalAddress.host;
  let port = Number(external?.port) || externalAddress.port || 0;

  if (!host) host = resolveDirectHost(inbound, panelHost);
  if (!port) port = Number(inbound.port) || 0;

  return { host, port, external };
}

function externalSni(inbound) {
  const external = firstExternalProxy(inbound);
  return firstNonEmpty(external?.sni, external?.host);
}

/**
 * Turn a 3x-ui client + inbound into a vless URI.
 * Supports TCP (+HTTP header), WS, gRPC, HTTPUpgrade and XHTTP transports with
 * none / TLS / Reality security.
 *
 * `overrides` mirrors what the panel's own subscription builder does for each
 * `externalProxy` entry: `security` forces TLS on/off, `sniFallback` fills an
 * empty TLS server name, `hostFallback` fills an empty transport Host header.
 */
function buildVlessUri(client, inbound, overrides = {}) {
  const stream = streamOf(inbound);
  const network = String(stream.network || 'tcp').toLowerCase();
  const security = String(overrides.security || stream.security || 'none').toLowerCase();
  const params = new URLSearchParams();

  params.set('type', network);
  params.set('security', security);
  params.set('encryption', 'none');

  if (client.flow) params.set('flow', String(client.flow));

  if (security === 'reality') {
    const reality = parseJsonField(stream.realitySettings);
    const realityInner = parseJsonField(reality.settings);
    const serverName = firstNonEmpty(
      overrides.sni,
      realityInner.serverName,
      reality.serverNames,
      reality.dest,
    ).split(':')[0];

    params.set('pbk', firstNonEmpty(realityInner.publicKey, reality.publicKey));
    params.set('fp', firstNonEmpty(realityInner.fingerprint, 'chrome'));
    if (serverName) params.set('sni', serverName);
    params.set('sid', firstNonEmpty(reality.shortIds, ''));
    const spiderX = firstNonEmpty(realityInner.spiderX);
    if (spiderX) params.set('spx', spiderX);
  } else if (security === 'tls') {
    const tls = parseJsonField(stream.tlsSettings);
    // 3x-ui always emits a fingerprint for TLS, defaulting to chrome.
    params.set('fp', String(firstNonEmpty(tls.fingerprint, 'chrome')));
    // Panel order: the inbound's serverName wins; an empty one falls back to the
    // external proxy destination.
    const serverName = firstNonEmpty(
      overrides.sni,
      tls.serverName,
      overrides.sniFallback,
    );
    if (serverName) params.set('sni', serverName);
    if (Array.isArray(tls.alpn) && tls.alpn.length > 0) {
      params.set('alpn', tls.alpn.join(','));
    }
    if (tls.allowInsecure === true || tls.allowInsecure === 'true') {
      params.set('allowInsecure', '1');
    }
  }

  if (network === 'ws') {
    const ws = parseJsonField(stream.wsSettings);
    params.set('path', firstNonEmpty(ws.path, '/'));
    const wsHost = firstNonEmpty(
      ws.headers?.Host,
      ws.headers?.host,
      ws.host,
      overrides.hostFallback,
    );
    if (wsHost) params.set('host', wsHost);
  } else if (network === 'grpc') {
    const grpc = parseJsonField(stream.grpcSettings);
    params.set('serviceName', firstNonEmpty(grpc.serviceName));
    if (grpc.authority) params.set('authority', String(grpc.authority));
    if (grpc.multiMode === true || grpc.multiMode === 'true') {
      params.set('mode', 'multi');
    }
  } else if (network === 'httpupgrade' || network === 'xhttp') {
    const transport = parseJsonField(
      network === 'httpupgrade' ? stream.httpupgradeSettings : stream.xhttpSettings,
    );
    params.set('path', firstNonEmpty(transport.path, '/'));
    const transportHost = firstNonEmpty(
      transport.host,
      transport.headers?.Host,
      transport.headers?.host,
      overrides.hostFallback,
    );
    if (transportHost) params.set('host', transportHost);
  } else if (network === 'tcp') {
    const tcp = parseJsonField(stream.tcpSettings);
    const header = parseJsonField(tcp.header);
    if (String(header.type || '').toLowerCase() === 'http') {
      const request = parseJsonField(header.request);
      params.set('headerType', 'http');
      params.set('path', firstNonEmpty(request.path, '/'));
      const requestHost = firstNonEmpty(
        request.headers?.Host,
        request.headers?.host,
        overrides.hostFallback,
      );
      if (requestHost) params.set('host', requestHost);
    }
  }

  const label = encodeURIComponent(overrides.remark || client.email || 'subscription');
  const authority = `${hostForUri(overrides.host)}:${overrides.port || inbound.port}`;
  return `vless://${client.id}@${authority}?${params.toString()}#${label}`;
}

/** vmess:// takes one base64-encoded JSON object (v2rayN format). */
function buildVmessUri(client, inbound, overrides = {}) {
  const stream = streamOf(inbound);
  const network = String(stream.network || 'tcp').toLowerCase();
  const security = String(stream.security || 'none').toLowerCase();

  const payload = {
    v: '2',
    ps: overrides.remark || client.email || 'subscription',
    add: overrides.host || '',
    port: String(overrides.port || inbound.port || ''),
    id: String(client.id || ''),
    aid: String(client.alterId ?? 0),
    scy: String(client.security || 'auto'),
    net: network,
    type: 'none',
    host: '',
    path: '',
    tls: security === 'tls' || security === 'reality' ? 'tls' : '',
    sni: '',
    alpn: '',
    fp: '',
  };

  if (network === 'ws') {
    const ws = parseJsonField(stream.wsSettings);
    payload.path = firstNonEmpty(ws.path, '/');
    payload.host = firstNonEmpty(ws.headers?.Host, ws.headers?.host);
  } else if (network === 'grpc') {
    const grpc = parseJsonField(stream.grpcSettings);
    payload.path = firstNonEmpty(grpc.serviceName);
    payload.host = firstNonEmpty(grpc.authority);
  } else if (network === 'httpupgrade' || network === 'xhttp') {
    const transport = parseJsonField(
      network === 'httpupgrade' ? stream.httpupgradeSettings : stream.xhttpSettings,
    );
    payload.path = firstNonEmpty(transport.path, '/');
    payload.host = firstNonEmpty(transport.host, transport.headers?.Host);
  } else if (network === 'tcp') {
    const tcp = parseJsonField(stream.tcpSettings);
    const header = parseJsonField(tcp.header);
    if (String(header.type || '').toLowerCase() === 'http') {
      const request = parseJsonField(header.request);
      payload.type = 'http';
      payload.path = firstNonEmpty(request.path, '/');
      payload.host = firstNonEmpty(request.headers?.Host, request.headers?.host);
    }
  }

  if (security === 'tls') {
    const tls = parseJsonField(stream.tlsSettings);
    payload.sni = firstNonEmpty(overrides.sni, tls.serverName, tls.serverNames);
    payload.fp = firstNonEmpty(tls.fingerprint);
    payload.alpn = Array.isArray(tls.alpn) ? tls.alpn.join(',') : '';
  } else if (security === 'reality') {
    const reality = parseJsonField(stream.realitySettings);
    payload.sni = firstNonEmpty(overrides.sni, reality.serverNames, reality.dest).split(':')[0];
  }

  return `vmess://${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')}`;
}

function buildTrojanUri(client, inbound, overrides = {}) {
  const stream = streamOf(inbound);
  const network = String(stream.network || 'tcp').toLowerCase();
  const security = String(stream.security || 'tls').toLowerCase();
  const params = new URLSearchParams();

  params.set('type', network);

  if (security === 'reality') {
    params.set('security', 'reality');
    const reality = parseJsonField(stream.realitySettings);
    const realityInner = parseJsonField(reality.settings);
    params.set('pbk', firstNonEmpty(realityInner.publicKey, reality.publicKey));
    params.set('fp', firstNonEmpty(realityInner.fingerprint, 'chrome'));
    params.set('sid', firstNonEmpty(reality.shortIds, ''));
    const sni = firstNonEmpty(overrides.sni, realityInner.serverName, reality.serverNames);
    if (sni) params.set('sni', String(sni).split(':')[0]);
  } else if (security === 'tls') {
    const tls = parseJsonField(stream.tlsSettings);
    const sni = firstNonEmpty(overrides.sni, tls.serverName, tls.serverNames);
    if (sni) params.set('sni', sni);
    if (tls.fingerprint) params.set('fp', String(tls.fingerprint));
  }

  if (network === 'ws') {
    const ws = parseJsonField(stream.wsSettings);
    params.set('path', firstNonEmpty(ws.path, '/'));
    const wsHost = firstNonEmpty(ws.headers?.Host, ws.headers?.host);
    if (wsHost) params.set('host', wsHost);
  } else if (network === 'grpc') {
    const grpc = parseJsonField(stream.grpcSettings);
    params.set('serviceName', firstNonEmpty(grpc.serviceName));
  }

  const label = encodeURIComponent(overrides.remark || client.email || 'subscription');
  const authority = `${hostForUri(overrides.host)}:${overrides.port || inbound.port}`;
  return `trojan://${encodeURIComponent(client.password || '')}@${authority}?${params.toString()}#${label}`;
}

/** Shadowsocks SIP002 URI. */
function buildShadowsocksUri(client, inbound, overrides = {}) {
  const method = String(client.method || '');
  const password = String(client.password || '');
  if (!method || !password) return null;
  const credentials = Buffer.from(`${method}:${password}`, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const label = encodeURIComponent(overrides.remark || client.email || 'subscription');
  return `ss://${credentials}@${hostForUri(overrides.host)}:${overrides.port || inbound.port}#${label}`;
}

function buildUriFor(client, inbound, endpoint) {
  const overrides = {
    host: endpoint.host,
    port: endpoint.port,
    sni: externalSni(inbound),
    remark: firstNonEmpty(client.remark, inbound.remark, client.email),
  };
  const protocol = String(inbound.protocol || '').toLowerCase();

  if (protocol === 'vless') return buildVlessUri(client, inbound, overrides);
  if (protocol === 'vmess') return buildVmessUri(client, inbound, overrides);
  if (protocol === 'trojan') return buildTrojanUri(client, inbound, overrides);
  if (protocol === 'shadowsocks' || protocol === 'ss') {
    return buildShadowsocksUri(client, inbound, overrides);
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Panel subscription (`XUI_SUB_URL`) parsing                                  */
/* -------------------------------------------------------------------------- */

function uriScheme(line) {
  const match = String(line || '').trim().match(URI_PREFIX);
  return match ? match[0].slice(0, -3).toLowerCase() : '';
}

/** Keep only complete URI lines, preserving their text byte-for-byte. */
function extractUriLines(text) {
  return String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && uriScheme(line) !== '');
}

/** Tolerate padded, unpadded and URL-safe Base64. */
function decodeBase64Text(text) {
  const compact = String(text || '').replace(/\s+/g, '');
  if (compact === '' || !/^[A-Za-z0-9+/=_-]+$/.test(compact)) return '';
  const normalized = compact.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  try {
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    // Replacement characters mean the input was not Base64 after all.
    return decoded.includes('\uFFFD') ? '' : decoded;
  } catch {
    return '';
  }
}

/**
 * A 3x-ui subscription body is either plain text (one URI per line) or the
 * Base64 form of that text.
 */
function parseSubscriptionBody(body) {
  const text = String(body || '');
  const plain = extractUriLines(text);
  if (plain.length > 0) return plain;

  const decoded = decodeBase64Text(text);
  return decoded ? extractUriLines(decoded) : [];
}

function decodeUriComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function lowerOr(value, fallback = '') {
  const text = String(value || '').trim();
  return text ? text.toLowerCase() : fallback;
}

/** `vmess://` carries one Base64-encoded JSON object instead of query params. */
function describeVmess(uri) {
  const payload = String(uri).slice('vmess://'.length).split('#')[0];
  const decoded = decodeBase64Text(payload);
  if (!decoded) return {};
  try {
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Display-only metadata for one subscription URI. The URI itself is never
 * rebuilt or normalized: it is passed through exactly as the panel sent it.
 */
function describeUri(uri) {
  const value = String(uri || '').trim();
  const protocol = lowerOr(uriScheme(value));
  if (!protocol) return null;

  const hashIndex = value.indexOf('#');
  const fragment = hashIndex === -1 ? '' : decodeUriComponentSafe(value.slice(hashIndex + 1));
  const beforeHash = hashIndex === -1 ? value : value.slice(0, hashIndex);
  const queryIndex = beforeHash.indexOf('?');
  const params = new URLSearchParams(queryIndex === -1 ? '' : beforeHash.slice(queryIndex + 1));

  if (protocol === 'vmess') {
    const payload = describeVmess(value);
    return {
      uri: value,
      remark: firstNonEmpty(fragment, payload.ps),
      protocol,
      network: lowerOr(payload.net, 'tcp'),
      security: lowerOr(payload.tls, 'none'),
    };
  }

  const defaultSecurity = protocol === 'trojan' || protocol === 'hysteria2' ? 'tls' : 'none';
  const defaultNetwork = protocol === 'ss' ? '' : 'tcp';
  return {
    uri: value,
    remark: fragment,
    protocol,
    network: lowerOr(params.get('type'), defaultNetwork),
    security: lowerOr(params.get('security'), defaultSecurity),
  };
}

/** Build the display list from a raw subscription body. */
function parseSubscriptionConfigs(body) {
  return parseSubscriptionBody(body)
    .map((uri) => describeUri(uri))
    .filter(Boolean);
}

/** A host that is only reachable over the LAN/Docker bridge, never public. */
function isInternalHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (host === '' || host === 'localhost' || host === 'host.docker.internal') return true;
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fd') || host.startsWith('fc')) {
    return true;
  }
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  // CGNAT range, used by some VPS/overlay networks.
  if (/^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)) return true;
  // A single-label name (`xui`, `panel`) only resolves inside a private network.
  if (!host.includes('.')) return true;
  const private172 = host.match(/^172\.(\d{1,3})\./);
  if (private172) {
    const second = Number(private172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

/**
 * Config name used by 3x-ui: `<email>-<externalProxy remark>` when the proxy
 * entry has one, else `<email>-<inbound remark>`, else the bare email.
 */
function configLabel(client, inbound, entry) {
  const email = String(client.email || '');
  const destinationRemark = firstNonEmpty(entry?.remark);
  if (destinationRemark) return `${email}-${destinationRemark}`;

  const inboundRemark = firstNonEmpty(inbound.remark);
  if (inboundRemark) return `${email}-${inboundRemark}`;

  return email || 'subscription';
}

/** Map `externalProxy.forceTls` onto the URI security value. */
function securityForExternalProxy(entry, inboundSecurity) {
  const forceTls = String(entry?.forceTls || '').toLowerCase();
  if (forceTls === 'tls') return 'tls';
  if (forceTls === 'none') return 'none';
  return inboundSecurity;
}

/**
 * Build one vless config per `externalProxy` entry, mirroring the panel's own
 * subscription generator: each proxy becomes its own address/port/TLS target.
 * Without `externalProxy`, a single config points at the inbound listener.
 */
function buildVlessConfigs(client, inbound, panelHost) {
  const stream = streamOf(inbound);
  const network = String(stream.network || 'tcp').toLowerCase();
  const inboundSecurity = String(stream.security || 'none').toLowerCase();
  const directHost = resolveDirectHost(inbound, panelHost);
  const directPort = Number(inbound.port) || 0;
  const entries = externalProxyList(inbound);

  const targets = entries.length > 0 ? entries : [null];
  return targets
    .map((entry) => {
      // `ep.dest` may carry a port (`host:port`); only the host part is used.
      const destination = splitHostPort(entry?.dest);
      const destinationHost = destination.host;
      const host = destinationHost || directHost;
      const port = Number(entry?.port) || directPort;
      const security = securityForExternalProxy(entry, inboundSecurity);
      const remark = configLabel(client, inbound, entry);

      const uri = buildVlessUri(client, inbound, {
        host,
        port,
        security,
        // The panel keeps `tlsSettings.serverName` as-is and only falls back to
        // `ep.dest` when the inbound has no server name; the same destination
        // fills an empty transport Host header.
        sniFallback: destinationHost,
        hostFallback: destinationHost,
        remark,
      });
      if (!uri) return null;

      return {
        remark,
        email: String(client.email || ''),
        protocol: 'vless',
        network,
        security,
        host,
        port,
        uri,
      };
    })
    .filter(Boolean);
}

class XuiService {
  constructor({
    panelUrl = process.env.PANEL_URL,
    username = process.env.PANEL_USERNAME,
    password = process.env.PANEL_PASSWORD,
    subscriptionUrl = process.env.XUI_SUB_URL,
    cacheTtlSeconds = process.env.CACHE_TTL_SECONDS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.panelUrl = normalizeBaseUrl(panelUrl);
    this.username = String(username || '');
    this.password = String(password || '');
    this.panelHost = this.panelUrl ? new URL(this.panelUrl).hostname : '';
    this.subscriptionUrl = normalizeBaseUrl(subscriptionUrl);
    // A self-signed certificate on the panel's internal Subscription port is
    // expected, so HTTPS on an internal host relaxes chain verification. Public
    // hosts keep full verification.
    this.subscriptionTlsInsecure =
      this.subscriptionUrl.startsWith('https://') &&
      isInternalHost(new URL(this.subscriptionUrl).hostname);

    const ttl = Number(cacheTtlSeconds);
    this.cacheTtlMs = Number.isFinite(ttl) && ttl >= 0 ? ttl * 1000 : 15_000;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;

    this.cookies = new Map();
    this.csrfToken = '';
    this.loginPromise = null;
    this.inboundsCache = null;
    this.inboundsPromise = null;
    this.onlineCache = null;
    this.onlinePromise = null;
    this.ipCache = new Map();
    this.subscriptionCache = new Map();
    this.subscriptionPromise = null;
    this.insecureFetchImpl = null;
  }

  get isConfigured() {
    return Boolean(this.username && this.password && this.panelUrl);
  }

  get hasSubscriptionUrl() {
    return Boolean(this.subscriptionUrl);
  }

  /** Fail fast on first use instead of at import time. */
  #assertConfigured() {
    if (!this.isConfigured) {
      throw new XuiError('Panel credentials are not configured', {
        status: 502,
        code: 'XUI_NOT_CONFIGURED',
      });
    }
  }

  #cookieHeader() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  #storeCookies(response) {
    const raw =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [response.headers.get('set-cookie')].filter(Boolean);

    for (const entry of raw) {
      const pair = entry.split(';', 1)[0];
      const separator = pair.indexOf('=');
      if (separator <= 0) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (name) this.cookies.set(name, value);
    }
  }

  /**
   * 3x-ui renders its login form behind CSRF middleware, so the session cookie
   * and the anti-CSRF token must come from the login page before the credential
   * POST. Skipping this step makes the panel answer 403.
   */
  async #fetchLoginPage() {
    try {
      const response = await this.fetchImpl(`${this.panelUrl}/`, {
        method: 'GET',
        headers: { Accept: 'text/html,application/xhtml+xml' },
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      this.#storeCookies(response);
      if (!response.ok) return '';

      const html = await response.text();
      const token = extractCsrfToken(html);
      if (token) return token;
      // Some builds keep the token in a cookie instead of the markup.
      return this.cookies.get('csrf') || this.cookies.get('_csrf') || '';
    } catch {
      // A panel without CSRF protection still logs in with credentials alone.
      return '';
    }
  }

  async login() {
    this.#assertConfigured();
    if (this.loginPromise) return this.loginPromise;

    this.loginPromise = (async () => {
      this.cookies.clear();
      this.csrfToken = '';

      const csrf = await this.#fetchLoginPage();
      this.csrfToken = csrf;

      // 3x-ui accepts JSON credentials on `/login`; the session cookie and the
      // CSRF token above are what make that POST pass the CSRF middleware.
      // A form-encoded POST is kept as a fallback for older builds.
      const jsonHeaders = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      if (csrf) jsonHeaders['X-CSRF-Token'] = csrf;
      const cookie = this.#cookieHeader();
      if (cookie) jsonHeaders.Cookie = cookie;

      let response = await this.fetchImpl(`${this.panelUrl}/login`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          username: this.username,
          password: this.password,
          ...(csrf ? { _csrf: csrf } : {}),
        }),
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      let rejected = response.status === 400 || response.status === 415;
      if (!rejected && response.ok) {
        try {
          const probe = await response.clone().json();
          rejected = Boolean(probe) && probe.success === false;
        } catch {
          rejected = false;
        }
      }

      if (rejected) {
        const form = new URLSearchParams({
          username: this.username,
          password: this.password,
        });
        const formHeaders = {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        };
        if (csrf) {
          form.set('_csrf', csrf);
          formHeaders['X-CSRF-Token'] = csrf;
        }
        const currentCookie = this.#cookieHeader();
        if (currentCookie) formHeaders.Cookie = currentCookie;

        response = await this.fetchImpl(`${this.panelUrl}/login`, {
          method: 'POST',
          headers: formHeaders,
          body: form.toString(),
          redirect: 'manual',
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      }

      if (response.status === 401 || response.status === 403) {
        throw new XuiError('Panel rejected the credentials', {
          status: 502,
          code: 'XUI_AUTH_FAILED',
        });
      }
      if (!response.ok) {
        throw new XuiError(`Panel login failed with HTTP ${response.status}`, {
          status: 502,
          code: 'XUI_LOGIN_FAILED',
        });
      }

      this.#storeCookies(response);
      if (this.cookies.size === 0) {
        throw new XuiError('Panel login did not return a session cookie', {
          status: 502,
          code: 'XUI_NO_SESSION',
        });
      }

      try {
        const payload = await response.json();
        if (payload && payload.success === false) {
          throw new XuiError('Panel rejected the credentials', {
            status: 502,
            code: 'XUI_AUTH_FAILED',
          });
        }
      } catch (error) {
        if (error instanceof XuiError) throw error;
        // A non-JSON but successful login response is still usable.
      }
    })();

    try {
      await this.loginPromise;
    } finally {
      this.loginPromise = null;
    }
  }

  async #request(path, { retryOnAuth = true, method = 'GET' } = {}) {
    this.#assertConfigured();
    if (this.cookies.size === 0) await this.login();

    const headers = {
      Accept: 'application/json',
      Cookie: this.#cookieHeader(),
    };
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      headers['X-Requested-With'] = 'XMLHttpRequest';
    }
    if (this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;

    const response = await this.fetchImpl(`${this.panelUrl}${path}`, {
      method,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (response.status === 401 || response.status === 403) {
      this.cookies.clear();
      if (!retryOnAuth) {
        throw new XuiError('Panel session expired', {
          status: 502,
          code: 'XUI_SESSION_EXPIRED',
        });
      }
      await this.login();
      return this.#request(path, { retryOnAuth: false, method });
    }

    if (!response.ok) {
      throw new XuiError(`Panel request failed with HTTP ${response.status}`, {
        status: 502,
        code: 'XUI_HTTP_ERROR',
      });
    }

    this.#storeCookies(response);

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new XuiError('Panel returned invalid JSON', {
        status: 502,
        code: 'XUI_BAD_JSON',
        cause: error,
      });
    }
    if (!payload || payload.success === false) {
      throw new XuiError('Panel request was rejected', {
        status: 502,
        code: 'XUI_REJECTED',
      });
    }
    return payload;
  }

  /**
   * Raw GET against the panel's Subscription service. No cookies are sent: that
   * endpoint authenticates with the `subId` in the path, not the admin session.
   */
  async #requestSubscriptionText(subId) {
    const target = this.#subscriptionTarget(subId);
    const headers = {
      Accept: '*/*',
      'User-Agent': SUBSCRIPTION_USER_AGENT,
    };

    // On an internal host the certificate is usually self-signed, and `fetch`
    // cannot skip verification without a custom dispatcher, so use `node:https`.
    const response = this.subscriptionTlsInsecure
      ? await this.#insecureGet(target, headers)
      : await this.fetchImpl(target, {
          method: 'GET',
          headers,
          redirect: 'follow',
          signal: AbortSignal.timeout(this.timeoutMs),
        }).catch((error) => {
          throw new XuiError('Subscription service is unreachable', {
            status: 502,
            code: 'XUI_SUB_UNREACHABLE',
            cause: error,
          });
        });

    const status = Number(response.status || 0);
    if (status < 200 || status >= 300) {
      throw new XuiError(`Subscription request failed with HTTP ${status}`, {
        status: 502,
        code: 'XUI_SUB_HTTP_ERROR',
      });
    }
    return response.text();
  }

  /** Substitute `{subId}` when the base URL carries it; otherwise append it. */
  #subscriptionTarget(subId) {
    const url = new URL(this.subscriptionUrl);
    // `new URL()` percent-encodes `{subId}`, so look for both forms. Assigning
    // the pathname back lets the URL parser encode the token exactly once.
    const pathname = url.pathname.replace(/%7B(subId|token)%7D/gi, '{$1}');
    url.pathname = SUBSCRIPTION_PLACEHOLDER.test(pathname)
      ? pathname.replace(SUBSCRIPTION_PLACEHOLDER, subId)
      : `${pathname.replace(/\/+$/, '')}/${subId}`;
    return url.toString();
  }

  /**
   * GET over `node:https` without chain verification, used for internal hosts
   * whose certificate is self-signed. Redirects are followed manually; the
   * relaxed agent is created once and reused (keep-alive is off because the
   * subscription port is a different origin from the panel API).
   */
  #insecureGet(target, headers, redirectsLeft = 3) {
    if (!this.insecureFetchImpl) {
      this.insecureFetchImpl = new https.Agent({ rejectUnauthorized: false, keepAlive: false });
    }

    return new Promise((resolve, reject) => {
      const url = new URL(target);
      const request = https.request(
        url,
        {
          method: 'GET',
          headers,
          agent: this.insecureFetchImpl,
          timeout: this.timeoutMs,
        },
        (response) => {
          const status = Number(response.statusCode) || 0;
          const location = response.headers.location;
          if (status >= 300 && status < 400 && location && redirectsLeft > 0) {
            response.resume();
            resolve(
              this.#insecureGet(new URL(location, url).toString(), headers, redirectsLeft - 1),
            );
            return;
          }

          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('error', (error) =>
            reject(
              new XuiError('Subscription service is unreachable', {
                status: 502,
                code: 'XUI_SUB_UNREACHABLE',
                cause: error,
              }),
            ),
          );
          response.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            if (status < 200 || status >= 300) {
              reject(
                new XuiError(`Subscription request failed with HTTP ${status}`, {
                  status: 502,
                  code: 'XUI_SUB_HTTP_ERROR',
                }),
              );
              return;
            }
            // Minimal `Response`-shaped object so both request paths agree.
            resolve({ status, text: async () => body });
          });
        },
      );

      request.on('timeout', () => request.destroy(new Error('Subscription request timed out')));
      request.on('error', (error) =>
        reject(
          new XuiError('Subscription service is unreachable', {
            status: 502,
            code: 'XUI_SUB_UNREACHABLE',
            cause: error,
          }),
        ),
      );
      request.end();
    });
  }

  /**
   * Configs exactly as the panel's Subscription service emits them, cached for
   * `CACHE_TTL_SECONDS` so a page load does not hammer the sub port.
   */
  async getSubscriptionConfigs(subId, { force = false } = {}) {
    const key = String(subId || '');
    if (!key || !this.hasSubscriptionUrl) return [];

    const cached = this.subscriptionCache.get(key);
    if (!force && cached && cached.expiresAt > Date.now()) return cached.configs;
    // Concurrent page loads for the *same* token share one upstream request.
    const pending = this.subscriptionPromise;
    if (!force && pending && pending.key === key) return pending.promise;

    const task = (async () => {
      const text = await this.#requestSubscriptionText(key);
      const configs = parseSubscriptionConfigs(text);
      if (configs.length === 0) {
        // 3x-ui answers a disabled/expired client with 200 and an empty body;
        // that is a normal state and yields an empty list. Anything else (HTML
        // from the panel UI, binary junk) means `XUI_SUB_URL` is misconfigured,
        // which must surface as an error instead of a silent empty page.
        if (String(text).trim() === '') return [];
        throw new XuiError('XUI_SUB_URL did not return a subscription', {
          status: 502,
          code: 'XUI_SUB_INVALID_BODY',
        });
      }

      if (this.subscriptionCache.size >= MAX_SUB_CACHE_ENTRIES) {
        const oldest = this.subscriptionCache.keys().next().value;
        if (oldest !== undefined) this.subscriptionCache.delete(oldest);
      }
      this.subscriptionCache.set(key, { configs, expiresAt: Date.now() + this.cacheTtlMs });
      return configs;
    })();
    this.subscriptionPromise = { key, promise: task };

    try {
      return await task;
    } finally {
      if (this.subscriptionPromise?.promise === task) this.subscriptionPromise = null;
    }
  }

  /** Inbound list, parsed and cached for `CACHE_TTL_SECONDS`. */
  async listInbounds({ force = false } = {}) {
    if (!force && this.inboundsCache && this.inboundsCache.expiresAt > Date.now()) {
      return this.inboundsCache.inbounds;
    }
    if (this.inboundsPromise) return this.inboundsPromise;

    this.inboundsPromise = (async () => {
      const payload = await this.#request('/panel/api/inbounds/list');
      const inbounds = Array.isArray(payload.obj) ? payload.obj : [];
      const parsed = inbounds.map((inbound) => ({
        ...inbound,
        settings: parseJsonField(inbound.settings),
        streamSettings: parseJsonField(inbound.streamSettings),
      }));

      this.inboundsCache = {
        inbounds: parsed,
        expiresAt: Date.now() + this.cacheTtlMs,
      };
      return parsed;
    })();

    try {
      return await this.inboundsPromise;
    } finally {
      this.inboundsPromise = null;
    }
  }

  /**
   * Resolve one subscription token.
   *
   * Usage/expiry/enable still come from `/panel/api/inbounds/list` (the same
   * data the panel UI shows), but the configs themselves are read from the
   * panel's own Subscription service when `XUI_SUB_URL` is configured, so the
   * URIs are byte-identical to what the panel hands to real clients. Without
   * `XUI_SUB_URL`, the inbound data is used to build the URIs locally.
   *
   * Returns `null` when the token is unknown.
   */
  async getClientByToken(token) {
    if (typeof token !== 'string') return null;
    // Strict exact-`subId` lookup: anything outside the token alphabet (an
    // email, a UUID, whitespace) is rejected here, before the panel is ever
    // contacted, and resolves to the same `null` as an unknown token.
    if (!isValidSubscriptionToken(token)) return null;
    const subId = token;

    const inbounds = await this.listInbounds();
    // Local fallback configs, only used when no subscription URL is configured.
    const fallbackConfigs = [];
    let matched = false;

    let upload = 0;
    let download = 0;
    let totalSum = 0;
    let unlimited = false;
    let expiryTime = 0;
    let enable = false;
    let email = '';

    for (const inbound of inbounds) {
      if (inbound.enable === false) continue;
      const clients = inbound.settings?.clients;
      if (!Array.isArray(clients)) continue;

      const matching = clients.filter(
        (item) => item && typeof item.subId === 'string' && item.subId === subId,
      );
      if (matching.length === 0) continue;

      matched = true;
      const statsList = Array.isArray(inbound.clientStats) ? inbound.clientStats : [];
      const endpoint = resolveEndpoint(inbound, this.panelHost);
      const stream = streamOf(inbound);
      const protocol = String(inbound.protocol || '').toLowerCase();

      for (const client of matching) {
        const stats = statsList.find(
          (item) => item && (item.email === client.email || item.id === client.id),
        );

        const up = Math.max(0, Number(stats?.up) || 0);
        const down = Math.max(0, Number(stats?.down) || 0);
        // `stats.total` is already bytes in 3x-ui. Multiplying `client.totalGB`
        // by 1024^3 turned 5 GB into ~5 EB, so nothing is scaled here.
        const configTotal = Math.max(0, Number(stats?.total) || 0);
        const configExpiry = normalizeEpochMs(stats?.expiryTime || client.expiryTime);
        const configEnable = stats ? Boolean(stats.enable) : Boolean(client.enable);

        upload += up;
        download += down;
        if (configTotal === 0) unlimited = true;
        else totalSum += configTotal;
        expiryTime = Math.max(expiryTime, configExpiry);
        enable = enable || configEnable;
        if (!email) email = String(client.email || '');

        if (!this.hasSubscriptionUrl) {
          // VLESS expands one config per `externalProxy` entry, exactly like the
          // panel's own subscription output.
          if (protocol === 'vless') {
            fallbackConfigs.push(...buildVlessConfigs(client, inbound, this.panelHost));
            continue;
          }

          fallbackConfigs.push({
            remark: firstNonEmpty(client.remark, inbound.remark, client.email),
            email: String(client.email || ''),
            protocol,
            network: String(stream.network || 'tcp').toLowerCase(),
            security: String(stream.security || 'none').toLowerCase(),
            host: endpoint.host,
            port: endpoint.port,
            uri: buildUriFor(client, inbound, endpoint),
          });
        }
      }
    }

    // The subscription service is the source of truth for the config list.
    const configs = this.hasSubscriptionUrl && matched
      ? await this.getSubscriptionConfigs(subId)
      : fallbackConfigs;

    if (!matched) return null;

    const usable = configs.filter((config) => typeof config.uri === 'string' && config.uri);
    // Without a subscription URL an empty list means the inbounds produced no
    // usable URI, which is a real failure. With one, the panel itself answered
    // with an empty body: the client exists but is disabled/expired, so keep
    // the record (the page renders the disabled state, /sub answers 409).
    if (usable.length === 0 && !this.hasSubscriptionUrl) return null;

    return {
      email: email || usable[0]?.email || '',
      enable,
      upload,
      download,
      total: unlimited ? 0 : totalSum,
      expiryTime,
      configs: usable,
      // Single-URI field kept for older front-end builds.
      vlessUri:
        (
          usable.find((config) => String(config.protocol).toUpperCase() === 'VLESS') || usable[0]
        )?.uri || null,
      uris: usable.map((config) => config.uri),
    };
  }

  /** Emails currently connected to the panel (cached briefly). */
  async getOnlineEmails() {
    if (this.onlineCache && this.onlineCache.expiresAt > Date.now()) {
      return this.onlineCache.emails;
    }
    if (this.onlinePromise) return this.onlinePromise;

    this.onlinePromise = (async () => {
      const payload = await this.#request('/panel/api/inbounds/onlines', {
        method: 'POST',
      });

      let list = [];
      const obj = payload.obj;
      if (Array.isArray(obj)) list = obj;
      else if (obj && typeof obj === 'object') list = Object.keys(obj);
      else if (typeof obj === 'string' && obj.trim() !== '') {
        try {
          const parsed = JSON.parse(obj);
          if (Array.isArray(parsed)) list = parsed;
        } catch {
          list = obj.split(',').map((entry) => entry.trim());
        }
      }

      const emails = new Set(
        list
          .map((entry) => (typeof entry === 'string' ? entry : entry?.email))
          .filter((entry) => typeof entry === 'string' && entry !== ''),
      );

      this.onlineCache = { emails, expiresAt: Date.now() + ONLINE_TTL_MS };
      return emails;
    })();

    try {
      return await this.onlinePromise;
    } finally {
      this.onlinePromise = null;
    }
  }

  async isClientOnline(email) {
    const value = String(email || '').trim();
    if (!value) return false;
    const emails = await this.getOnlineEmails();
    return emails.has(value);
  }

  /**
   * Raw IP log for one client. Never returned by the HTTP layer: the caller
   * aggregates it into per-country counts first.
   */
  async getClientIps(email) {
    const value = String(email || '').trim();
    if (!value) return [];

    const cached = this.ipCache.get(value);
    if (cached?.ips && cached.expiresAt > Date.now()) return cached.ips;
    if (cached?.promise) return cached.promise;

    const promise = (async () => {
      let ips = [];
      try {
        const payload = await this.#request(
          `/panel/api/inbounds/clientIps/${encodeURIComponent(value)}`,
          { method: 'POST' },
        );
        const obj = payload.obj ?? payload;
        if (Array.isArray(obj)) ips = obj;
        else if (obj && typeof obj === 'object') ips = Object.keys(obj);
        else if (typeof obj === 'string' && obj.trim() !== '') {
          try {
            const parsed = JSON.parse(obj);
            ips = Array.isArray(parsed) ? parsed : Object.keys(parsed || {});
          } catch {
            ips = [];
          }
        }
      } catch {
        // Presence data is best-effort; an unavailable log must not break the page.
        ips = [];
      }

      if (this.ipCache.size >= MAX_IP_CACHE_ENTRIES) {
        const oldest = this.ipCache.keys().next().value;
        if (oldest !== undefined) this.ipCache.delete(oldest);
      }
      this.ipCache.set(value, { ips, expiresAt: Date.now() + IP_CACHE_TTL_MS });
      return ips;
    })();

    const entry = this.ipCache.get(value) || {};
    this.ipCache.set(value, { ...entry, promise, expiresAt: entry.expiresAt || 0 });

    try {
      return await promise;
    } finally {
      const latest = this.ipCache.get(value);
      if (latest?.promise === promise) {
        this.ipCache.set(value, {
          ips: latest.ips || [],
          expiresAt: latest.expiresAt || 0,
        });
      }
    }
  }
}

module.exports = {
  XuiService,
  XuiError,
  isValidSubscriptionToken,
  buildVlessUri,
  buildVmessUri,
  buildTrojanUri,
  buildShadowsocksUri,
  buildUriFor,
  buildVlessConfigs,
  describeUri,
  parseSubscriptionBody,
  parseSubscriptionConfigs,
  isInternalHost,
  extractCsrfToken,
  resolveEndpoint,
  splitHostPort,
  parseJsonField,
  normalizeEpochMs,
  firstNonEmpty,
};
