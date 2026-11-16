import { useEffect, useState } from 'react';

/**
 * Defaults mirror `.env.example` so the page stays presentable when the API is
 * unreachable (for example while the panel is down).
 */
export const DEFAULT_PUBLIC_CONFIG = {
  appTitle: 'پنل اشتراک',
  announcement: {
    enabled: true,
    title: 'اطلاعیه مهم',
    text: 'این یک متن اطلاعیه تستی است. برای دریافت آخرین وضعیت سرورها و راهنمای اتصال این بخش را بررسی کنید.',
  },
  footer: {
    authorName: 'VPNacho',
    authorUrl: 'https://github.com/VPNacho',
  },
  enableHomeLookup: true,
  profileUpdateInterval: 12,
};

function mergeConfig(payload) {
  if (!payload || typeof payload !== 'object') return DEFAULT_PUBLIC_CONFIG;
  return {
    ...DEFAULT_PUBLIC_CONFIG,
    ...payload,
    announcement: {
      ...DEFAULT_PUBLIC_CONFIG.announcement,
      ...(payload.announcement && typeof payload.announcement === 'object'
        ? payload.announcement
        : {}),
    },
    footer: {
      ...DEFAULT_PUBLIC_CONFIG.footer,
      ...(payload.footer && typeof payload.footer === 'object' ? payload.footer : {}),
    },
  };
}

/** Loads the operator-controlled, public-only settings once per page view. */
export function usePublicConfig() {
  const [config, setConfig] = useState(DEFAULT_PUBLIC_CONFIG);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const response = await fetch('/api/public-config', {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) return;
        setConfig(mergeConfig(await response.json()));
      } catch {
        // Defaults are already rendered; nothing else to do.
      }
    })();

    return () => controller.abort();
  }, []);

  return config;
}
