'use strict';

/**
 * Country aggregation for the connected-IP list.
 *
 * The panel API returns raw IP addresses. They are resolved to a country code
 * here and never leave this module: the HTTP layer only ever sees
 * `{ connections, countries: [{ code, name, count }] }`.
 */

const net = require('node:net');
const geoip = require('geoip-lite');

const UNKNOWN_CODE = 'XX';
const UNKNOWN_NAME = 'نامشخص';

/** Persian region names straight from ICU (node:20 ships full-icu). */
const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['fa'], { type: 'region' });
  } catch {
    return null;
  }
})();

function countryName(code) {
  if (!code || code === UNKNOWN_CODE) return UNKNOWN_NAME;
  if (regionNames) {
    try {
      const label = regionNames.of(code);
      if (label && label !== code) return label;
    } catch {
      // Unknown region code: fall through to the raw code.
    }
  }
  return code;
}

/**
 * Tolerate every address shape the panel logs use:
 * `1.2.3.4`, `1.2.3.4:443`, `[2001:db8::1]:443`, `::ffff:1.2.3.4`, `fe80::1%eth0`.
 */
function normalizeIp(raw) {
  let value = String(raw ?? '').trim();
  if (!value) return '';

  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end > 0) value = value.slice(1, end);
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) {
    value = value.slice(0, value.lastIndexOf(':'));
  } else if ((value.match(/:/g) || []).length === 1 && /^[^:]+:\d+$/.test(value)) {
    value = value.slice(0, value.lastIndexOf(':'));
  }

  const zone = value.indexOf('%');
  if (zone > 0) value = value.slice(0, zone);
  if (value.toLowerCase().startsWith('::ffff:')) value = value.slice(7);
  if (value === '::1') return '127.0.0.1';

  return net.isIP(value) ? value : '';
}

/** Panel payloads may be `["ip"]`, `[{ ip }]`, `{ "ip": count }` or a map. */
function extractIps(payload) {
  if (!payload) return [];
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return [];
    try {
      return extractIps(JSON.parse(trimmed));
    } catch {
      return trimmed.split(/[\s,]+/);
    }
  }
  if (Array.isArray(payload)) {
    return payload
      .map((item) => {
        if (typeof item === 'string') return item;
        if (!item || typeof item !== 'object') return '';
        return item.ip ?? item.IP ?? item.addr ?? item.address ?? item.remoteAddr ?? '';
      })
      .filter(Boolean);
  }
  if (typeof payload === 'object') return Object.keys(payload);
  return [];
}

function uniqueIps(payload) {
  const seen = new Set();
  for (const raw of extractIps(payload)) {
    const ip = normalizeIp(raw);
    if (ip) seen.add(ip);
  }
  return [...seen];
}

/**
 * @returns {{ connections: number, countries: Array<{ code: string, name: string, count: number }> }}
 */
function summarizeCountries(payload) {
  const ips = uniqueIps(payload);
  const counts = new Map();

  for (const ip of ips) {
    let code = UNKNOWN_CODE;
    try {
      const record = geoip.lookup(ip);
      if (record && record.country) code = String(record.country).toUpperCase();
    } catch {
      code = UNKNOWN_CODE;
    }
    counts.set(code, (counts.get(code) || 0) + 1);
  }

  const countries = [...counts.entries()]
    .map(([code, count]) => ({ code, name: countryName(code), count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fa'));

  return { connections: ips.length, countries };
}

module.exports = {
  normalizeIp,
  uniqueIps,
  summarizeCountries,
  countryName,
  UNKNOWN_CODE,
};
