import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AlertIcon, CheckIcon, CloseIcon } from './Icons';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());
  const counter = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (message, { tone = 'success', duration = 2600 } = {}) => {
      counter.current += 1;
      const id = counter.current;
      setToasts((current) => [...current.slice(-2), { id, message, tone }]);
      const timer = window.setTimeout(() => dismiss(id), duration);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
      timers.current.clear();
    },
    [],
  );

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => {
          const isError = toast.tone === 'error';
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold ring-1 backdrop-blur-xl animate-riseIn ${
                isError
                  ? 'bg-saul-crimson/20 text-rose-100 ring-saul-crimson/40 shadow-crimson'
                  : 'bg-void-700/90 text-slate-100 ring-saul-gold/30 shadow-gold'
              }`}
            >
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${
                  isError ? 'bg-saul-crimson/30 text-rose-200' : 'bg-saul-gold/20 text-saul-gold'
                }`}
              >
                {isError ? <AlertIcon className="h-4 w-4" /> : <CheckIcon className="h-4 w-4" />}
              </span>
              <span className="flex-1 leading-6">{toast.message}</span>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="rounded-full p-1 text-slate-400 transition hover:bg-white/10 hover:text-white"
                aria-label="بستن اعلان"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
