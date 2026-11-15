'use strict';

/**
 * Minimal, read-only client for the 3x-ui (MHSanaei) panel API.
 *
 * Responsibilities:
 *   - keep an authenticated cookie in memory and renew it on 401/403
 *   - list inbounds with a short TTL cache
 *   - resolve a single client by its subscription id (`subId`)
 *   - build a standards-compliant `vless://` URI for that client only
 *
 * The service never exposes panel credentials or data of other clients.
 */

const GB = 1024 ** 3;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TOKEN_LENGTH = 128;

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
    }
  }
  return '';
}

function hostForUri(host) {
  if (!host) return '';
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function normalizeBaseUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

/**
 * Turn a 3x-ui client + inbound into a vless URI.
 * Supports TCP (+HTTP header), WS, gRPC, HTTPUpgrade and XHTTP transports with
 * none / TLS / Reality security.
 */
function buildVlessUri(client, inbound, host) {
  const stream = parseJsonField(inbound.streamSettings);
  const network = String(stream.network || 'tcp').toLowerCase();
  const security = String(stream.security || 'none').toLowerCase();
  const params = new URLSearchParams();

  params.set('type', network);
  params.set('security', security);
  params.set('encryption', 'none');

  if (client.flow) params.set('flow', String(client.flow));

  if (security === 'reality') {
    const reality = parseJsonField(stream.realitySettings);
    const realityInner = parseJsonField(reality.settings);
    const serverName = firstNonEmpty(
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
    const serverName = firstNonEmpty(tls.serverName, tls.serverNames);
    if (serverName) params.set('sni', serverName);
    if (tls.fingerprint) params.set('fp', String(tls.fingerprint));
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
    const wsHost = firstNonEmpty(ws.headers?.Host, ws.headers?.host);
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
    const transportHost = firstNonEmpty(transport.host, transport.headers?.Host);
    if (transportHost) params.set('host', transportHost);
  } else if (network === 'tcp') {
    const tcp = parseJsonField(stream.tcpSettings);
    const header = parseJsonField(tcp.header);
    if (String(header.type || '').toLowerCase() === 'http') {
      const request = parseJsonField(header.request);
      params.set('headerType', 'http');
      params.set('path', firstNonEmpty(request.path, '/'));
      const requestHost = firstNonEmpty(request.headers?.Host, request.headers?.host);
      if (requestHost) params.set('host', requestHost);
    }
  }

  const label = encodeURIComponent(client.email || 'subscription');
  const authority = `${hostForUri(host)}:${inbound.port}`;
  return `vless://${client.id}@${authority}?${params.toString()}#${label}`;
}

class XuiService {
  constructor({
    panelUrl = process.env.PANEL_URL,
    username = process.env.PANEL_USERNAME,
    password = process.env.PANEL_PASSWORD,
    cacheTtlSeconds = process.env.CACHE_TTL_SECONDS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.panelUrl = normalizeBaseUrl(panelUrl);
    this.username = String(username || '');
    this.password = String(password || '');
    this.panelHost = this.panelUrl ? new URL(this.panelUrl).hostname : '';

    const ttl = Number(cacheTtlSeconds);
    this.cacheTtlMs = Number.isFinite(ttl) && ttl >= 0 ? ttl * 1000 : 15_000;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;

    this.cookies = new Map();
    this.loginPromise = null;
    this.inboundsCache = null;
    this.inboundsPromise = null;
  }

  get isConfigured() {
    return Boolean(this.username && this.password && this.panelUrl);
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

  async login() {
    this.#assertConfigured();
    if (this.loginPromise) return this.loginPromise;

    this.loginPromise = (async () => {
      this.cookies.clear();
      const response = await this.fetchImpl(`${this.panelUrl}/login`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: this.username, password: this.password }),
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });

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

  async #request(path, { retryOnAuth = true } = {}) {
    this.#assertConfigured();
    if (this.cookies.size === 0) await this.login();

    const response = await this.fetchImpl(`${this.panelUrl}${path}`, {
      headers: {
        Accept: 'application/json',
        Cookie: this.#cookieHeader(),
      },
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
      return this.#request(path, { retryOnAuth: false });
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
   * Resolve exactly one client by subscription token.
   * Returns `null` when the token is unknown.
   */
  async getClientByToken(token) {
    if (typeof token !== 'string') return null;
    const subId = token.trim();
    if (!subId || subId.length > MAX_TOKEN_LENGTH) return null;

    const inbounds = await this.listInbounds();

    for (const inbound of inbounds) {
      const clients = inbound.settings?.clients;
      if (!Array.isArray(clients)) continue;

      const client = clients.find(
        (item) => item && typeof item.subId === 'string' && item.subId === subId,
      );
      if (!client) continue;

      const stats = (Array.isArray(inbound.clientStats) ? inbound.clientStats : []).find(
        (item) => item && (item.email === client.email || item.id === client.id),
      );

      const upload = Math.max(0, Number(stats?.up) || 0);
      const download = Math.max(0, Number(stats?.down) || 0);
      const total = Math.max(
        0,
        Number(stats?.total) || 0,
        (Number(client.totalGB) || 0) * GB,
      );
      const expiryTime = normalizeEpochMs(stats?.expiryTime || client.expiryTime);
      const enable = stats ? Boolean(stats.enable) : Boolean(client.enable);

      const host = this.#resolveHost(inbound);
      const vlessUri =
        String(inbound.protocol || '').toLowerCase() === 'vless'
          ? buildVlessUri(client, inbound, host)
          : null;

      return {
        email: String(client.email || ''),
        enable,
        upload,
        download,
        total,
        expiryTime,
        vlessUri,
      };
    }

    return null;
  }

  /** Best-effort public address for the URI; override with VLESS_HOST. */
  #resolveHost(inbound) {
    const override = String(process.env.VLESS_HOST || '').trim();
    if (override) return override;

    const listen = String(inbound.listen || '').trim();
    const isWildcard =
      listen === '' || listen === '0.0.0.0' || listen === '::' || listen.startsWith('127.');
    return isWildcard ? this.panelHost : listen;
  }
}

module.exports = {
  XuiService,
  XuiError,
  buildVlessUri,
  parseJsonField,
  normalizeEpochMs,
};
