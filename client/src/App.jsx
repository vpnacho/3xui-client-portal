import { useCallback, useEffect, useRef, useState } from 'react';
import { CosmicBackdrop } from './components/CosmicBackdrop';
import { ErrorState, LoadingState } from './components/States';
import { SubscriptionCard } from './components/SubscriptionCard';
import { ToastProvider } from './components/Toast';
import { ShieldIcon } from './components/Icons';
import { clientApiPath, parseToken } from './lib/links';

function StatusFooter() {
  return (
    <footer className="mt-6 flex flex-col items-center gap-2 text-center">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-[10px] muted">
        <ShieldIcon className="h-3 w-3 text-emerald-400/70" />
        اتصال امن · بدون ذخیره‌سازی اطلاعات
      </span>
      <p className="text-[10px] muted-dim">
        دوره به‌روزرسانی خودکار پروفایل: هر ۱۲ ساعت
      </p>
    </footer>
  );
}

export default function App() {
  const [token] = useState(() => parseToken());
  const [status, setStatus] = useState(() => (token ? 'loading' : 'not-found'));
  const [client, setClient] = useState(null);
  const controllerRef = useRef(null);

  const load = useCallback(async () => {
    if (!token) {
      setStatus('not-found');
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setStatus('loading');
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
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      setClient(payload);
      setStatus('ready');
    } catch (error) {
      if (error?.name === 'AbortError') return;
      setStatus('error');
    }
  }, [token]);

  useEffect(() => {
    load();
    return () => controllerRef.current?.abort();
  }, [load]);

  useEffect(() => {
    document.title = client?.email
      ? `${client.email} · اشتراک`
      : 'اشتراک · 3x-ui Client Portal';
  }, [client?.email]);

  return (
    <ToastProvider>
      <CosmicBackdrop />

      <main className="relative mx-auto flex min-h-screen w-full max-w-[640px] flex-col justify-center px-4 py-10 safe-bottom sm:px-6 sm:py-14">
        <div className="animate-riseIn">
          {status === 'loading' ? <LoadingState /> : null}
          {status === 'not-found' ? <ErrorState kind="not-found" /> : null}
          {status === 'error' ? <ErrorState onRetry={load} /> : null}
          {status === 'ready' && client ? <SubscriptionCard client={client} /> : null}

          <StatusFooter />
        </div>
      </main>
    </ToastProvider>
  );
}
