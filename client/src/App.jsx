import { useCallback, useEffect, useRef, useState } from 'react';
import { Announcement } from './components/Announcement';
import { CosmicBackdrop } from './components/CosmicBackdrop';
import { Footer } from './components/Footer';
import { HomeLookup } from './components/HomeLookup';
import { ErrorState, LoadingState } from './components/States';
import { SubscriptionCard } from './components/SubscriptionCard';
import { ToastProvider } from './components/Toast';
import { usePublicConfig } from './hooks/usePublicConfig';
import { clientApiPath, parseToken } from './lib/links';

/** Refresh the live status without hammering the rate limiter. */
const STATUS_REFRESH_MS = 45_000;

export default function App() {
  const config = usePublicConfig();
  const [token] = useState(() => parseToken());
  const [status, setStatus] = useState(() => (token ? 'loading' : 'home'));
  const [client, setClient] = useState(null);
  const controllerRef = useRef(null);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!token) {
        setStatus('home');
        return;
      }

      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      if (!silent) setStatus('loading');
      try {
        const response = await fetch(clientApiPath(token), {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });

        if (response.status === 404) {
          setClient(null);
          setStatus('not-found');
          return;
        }
        if (response.status === 429) {
          // A throttled background poll must not replace a rendered page.
          setStatus((current) => (current === 'ready' ? 'ready' : 'throttled'));
          return;
        }
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        setClient(await response.json());
        setStatus('ready');
      } catch (error) {
        if (error?.name === 'AbortError') return;
        // Keep the last good payload visible when only a refresh failed.
        setStatus((current) => (current === 'ready' ? 'ready' : 'error'));
      }
    },
    [token],
  );

  useEffect(() => {
    load();
    return () => controllerRef.current?.abort();
  }, [load]);

  useEffect(() => {
    if (status !== 'ready') return undefined;
    const timer = window.setInterval(() => load({ silent: true }), STATUS_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load, status]);

  useEffect(() => {
    const base = String(config.appTitle || 'پنل اشتراک');
    document.title = client?.email ? `${client.email} · ${base}` : base;
  }, [client?.email, config.appTitle]);

  const showHome = !token && config.enableHomeLookup !== false;

  return (
    <ToastProvider>
      <CosmicBackdrop />

      <main className="relative mx-auto flex min-h-screen w-full max-w-[640px] flex-col justify-center px-4 py-10 safe-bottom sm:px-6 sm:py-14">
        <div className="space-y-4 animate-riseIn">
          {showHome ? <HomeLookup /> : null}
          {!showHome && !token ? <ErrorState kind="not-found" /> : null}

          {config.announcement?.enabled ? (
            <Announcement announcement={config.announcement} />
          ) : null}

          {status === 'loading' ? <LoadingState /> : null}
          {status === 'not-found' ? <ErrorState kind="not-found" /> : null}
          {status === 'throttled' ? <ErrorState kind="throttled" onRetry={() => load()} /> : null}
          {status === 'error' ? <ErrorState onRetry={() => load()} /> : null}
          {status === 'ready' && client ? (
            <SubscriptionCard
              client={client}
              profileUpdateInterval={config.profileUpdateInterval}
            />
          ) : null}

          <Footer
            footer={config.footer}
            profileUpdateInterval={config.profileUpdateInterval}
          />
        </div>
      </main>
    </ToastProvider>
  );
}
