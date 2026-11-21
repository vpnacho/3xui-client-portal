/** Deep links understood by the popular VLESS clients. */
const BASE = '/api/client';

export const importApps = [
  {
    id: 'happ',
    name: 'Happ',
    hint: 'iOS · macOS · Android',
    build: (url) => `happ://add/${encodeURIComponent(url)}`,
  },
  {
    id: 'karing',
    name: 'Karing',
    hint: 'iOS · Android · Desktop',
    build: (url) => `karing://install-config?url=${encodeURIComponent(url)}`,
  },
  {
    id: 'streisand',
    name: 'Streisand',
    hint: 'iOS · macOS',
    build: (url) => `streisand://import/${encodeURIComponent(url)}`,
  },
  {
    id: 'v2rayng',
    name: 'v2rayNG',
    hint: 'Android',
    build: (url) => `v2rayng://install-sub?url=${encodeURIComponent(url)}`,
  },
];

export function parseToken(pathname = window.location.pathname, subPath = 'sub') {
  const segment = String(subPath || 'sub').replace(/^\/+|\/+$/g, '');
  const pattern = new RegExp(`^\\/${segment}\\/([^/]+)\\/?$`);
  const match = pathname.match(pattern);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return '';
  }
}

export function clientApiPath(token) {
  return `${BASE}/${encodeURIComponent(token)}`;
}
