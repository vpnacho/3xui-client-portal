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
  const subPath = config.subPath || 'sub';

  /**
   * Derived from the current pathname + the resolved subPath.
   * For SUB_PATH=sub (default) this is correct from the very first render.
   * For a custom subPath it becomes non-empty once /api/public-config returns,
   * which triggers load() through the [token] dependency chain.
   */
  const token = parseToken(window.location.pathname, subPath);

  const [status, setStatus] = useState(() => {
    // Optimistic: if the default 'sub' prefix matches, we already know we have a
    // token and can go straight to loading. Otherwise start at 'home' — load()
    // corrects it once the real subPath resolves.
    return parseToken(window.location.pathname, 'sub') ? 'loading' : 'home';
  });
  const [client, setClient] = useState(null);
  /** Absolute ms timestamp until which retries are blocked (0 = not blocked). */
  const [retryUntil, setRetryUntil] = useState(0);
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
          // Extract retryAfter from body or header.
          let retryAfterSecs = 60;
          try {
            const body = await response.json();
            if (typeof body.retryAfter === 'number' && body.retryAfter > 0) {
              retryAfterSecs = body.retryAfter;
            } else {
              const header = response.headers.get('Retry-After');
              if (header) retryAfterSecs = Math.max(1, Number(header) || retryAfterSecs);
            }
          } catch {
            const header = response.headers.get('Retry-After');
            if (header) retryAfterSecs = Math.max(1, Number(header) || retryAfterSecs);
          }
          setRetryUntil(Date.now() + retryAfterSecs * 1000);
          // A throttled background poll must not replace a rendered page.
          setStatus((current) => (current === 'ready' ? 'ready' : 'throttled'));
          return;
        }
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        setRetryUntil(0);
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
          {showHome ? <HomeLookup subPath={subPath} /> : null}
          {!showHome && !token ? <ErrorState kind="not-found" /> : null}

          {config.announcement?.enabled ? (
            <Announcement announcement={config.announcement} />
          ) : null}

          {status === 'loading' ? <LoadingState /> : null}
          {status === 'not-found' ? <ErrorState kind="not-found" /> : null}
          {status === 'throttled' ? (
            <ErrorState kind="throttled" retryUntil={retryUntil} onRetry={() => load()} />
          ) : null}
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
