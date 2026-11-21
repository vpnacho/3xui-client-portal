import { useCallback, useEffect, useState } from 'react';
import { BoltIcon, ShieldIcon } from './Icons';
import { clientApiPath } from '../lib/links';
import { useNow } from '../hooks/useNow';

/** Matches the backend regex exactly: letters, digits, hyphen, underscore, 6–64 chars. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

/**
 * Root-page subscription lookup. The token is validated locally, then
 * pre-checked against the API before navigation — nothing is stored or logged.
 */
export function HomeLookup({ subPath = 'sub' }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  /** Absolute ms timestamp until which new submissions are blocked (0 = not blocked). */
  const [retryUntil, setRetryUntil] = useState(0);

  const isRateLimited = retryUntil > 0;
  const now = useNow(isRateLimited);
  const retrySecsLeft = isRateLimited ? Math.max(0, Math.ceil((retryUntil - now) / 1000)) : 0;
  const isBlocked = loading || retrySecsLeft > 0;

  // Auto-clear the rate-limit window once the timer elapses.
  useEffect(() => {
    if (retryUntil <= 0) return undefined;
    const remaining = retryUntil - Date.now();
    if (remaining <= 0) { setRetryUntil(0); return undefined; }
    const timer = window.setTimeout(() => setRetryUntil(0), remaining);
    return () => window.clearTimeout(timer);
  }, [retryUntil]);

  const submit = useCallback(
    async (event) => {
      event.preventDefault();
      if (isBlocked) return;

      const token = value.trim().replace(/^\/+|\/+$/g, '');

      if (!token) {
        setError('شناسه اشتراک را وارد کنید.');
        return;
      }
      if (!TOKEN_PATTERN.test(token)) {
        setError(
          'شناسه اشتراک باید بین ۶ تا ۶۴ کاراکتر و فقط شامل حروف انگلیسی، ارقام، - و _ باشد.',
        );
        return;
      }

      setError('');
      setLoading(true);

      try {
        const response = await fetch(clientApiPath(token), {
          headers: { Accept: 'application/json' },
        });

        if (response.status === 429) {
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
          setLoading(false);
          return;
        }

        if (response.status === 404) {
          setError('اشتراکی با این شناسه پیدا نشد. لطفاً شناسه را دوباره بررسی کنید.');
          setLoading(false);
          return;
        }

        if (!response.ok) {
          setError('خطا در ارتباط با سرور. لطفاً دوباره تلاش کنید.');
          setLoading(false);
          return;
        }

        window.location.assign(`/${encodeURIComponent(subPath || 'sub')}/${encodeURIComponent(token)}`);
      } catch {
        setError('خطا در ارتباط با سرور. لطفاً دوباره تلاش کنید.');
        setLoading(false);
      }
    },
    [value, isBlocked],
  );

  const hasError = Boolean(error) && retrySecsLeft === 0;

  return (
    <section className="glass grain hairline-gold relative overflow-hidden rounded-[28px] p-6 sm:p-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -left-16 h-56 w-56 rounded-full bg-saul-gold/10 blur-3xl"
      />

      <div className="relative space-y-6">
        <header className="space-y-2 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-saul-gold/30 bg-saul-gold/12 text-saul-gold shadow-gold">
            <BoltIcon className="h-5 w-5" />
          </span>
          <h1 className="text-2xl font-extrabold leading-tight text-white text-glow-gold">
            جستجوی اشتراک
          </h1>
          <p className="mx-auto max-w-sm text-[11.5px] leading-6 muted">
            شناسه اشتراک خود را وارد کنید تا صفحه اختصاصی مصرف، انقضا و کانفیگ‌های شما باز شود.
          </p>
        </header>

        <form onSubmit={submit} className="space-y-3" noValidate>
          <label htmlFor="sub-token" className="eyebrow block">
            شناسه اشتراک (subId)
          </label>

          <div
            className={`flex flex-col gap-2 rounded-2xl border bg-void-900/70 p-1.5 transition sm:flex-row sm:items-center ${
              hasError || retrySecsLeft > 0
                ? 'border-saul-crimson/50'
                : 'border-white/10 focus-within:border-saul-gold/40'
            }`}
          >
            <input
              id="sub-token"
              name="token"
              type="text"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                if (error) setError('');
              }}
              dir="ltr"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="e.g. 3f9c1a7d2b"
              disabled={loading}
              aria-invalid={hasError || retrySecsLeft > 0}
              aria-describedby={
                retrySecsLeft > 0
                  ? 'sub-token-ratelimit'
                  : hasError
                    ? 'sub-token-error'
                    : undefined
              }
              className="mono min-w-0 flex-1 rounded-xl bg-transparent px-3 py-2.5 text-left text-[13px] tracking-wide text-slate-100 outline-none placeholder:text-slate-600 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isBlocked}
              className="btn btn-gold shrink-0 !rounded-xl text-[12px] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <span
                  aria-hidden="true"
                  className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                />
              ) : (
                <BoltIcon className="h-3.5 w-3.5" />
              )}
              {retrySecsLeft > 0 ? `${retrySecsLeft} ثانیه` : 'مشاهده اشتراک'}
            </button>
          </div>

          {retrySecsLeft > 0 ? (
            <p
              id="sub-token-ratelimit"
              role="alert"
              className="text-[11px] font-semibold text-amber-300"
            >
              تعداد درخواست‌ها بیش از حد مجاز است — {retrySecsLeft} ثانیه دیگر دوباره تلاش کنید.
            </p>
          ) : hasError ? (
            <p id="sub-token-error" role="alert" className="text-[11px] font-semibold text-rose-300">
              {error}
            </p>
          ) : null}
        </form>

        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3.5">
          <div className="mb-2 flex items-center gap-2">
            <ShieldIcon className="h-3.5 w-3.5 text-emerald-400/80" />
            <p className="text-[10.5px] font-bold text-slate-300">راهنمای امنیتی</p>
          </div>
          <ul className="space-y-1.5 text-[10.5px] leading-5 muted">
            <li>- شناسه اشتراک مثل رمز عبور است؛ آن را با کسی به اشتراک نگذارید.</li>
            <li>- این صفحه فقط اطلاعات همان شناسه را نمایش می‌دهد و هیچ داده‌ای ذخیره نمی‌کند.</li>
            <li>- در صورت لو رفتن شناسه، از پشتیبانی درخواست صدور مجدد کنید.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
