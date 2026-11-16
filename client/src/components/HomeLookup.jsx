import { useCallback, useState } from 'react';
import { BoltIcon, ShieldIcon } from './Icons';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Root-page subscription lookup. The token is pasted, validated locally and
 * then navigated to - nothing is sent to the API from this page, and the input
 * is never stored or logged.
 */
export function HomeLookup() {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const submit = useCallback(
    (event) => {
      event.preventDefault();
      const token = value.trim().replace(/^\/+|\/+$/g, '');

      if (!token) {
        setError('شناسه اشتراک را وارد کنید.');
        return;
      }
      if (!TOKEN_PATTERN.test(token)) {
        setError('شناسه اشتراک باید حداقل ۸ کاراکتر و فقط شامل حروف، ارقام، - و _ باشد.');
        return;
      }

      setError('');
      window.location.assign(`/sub/${encodeURIComponent(token)}`);
    },
    [value],
  );

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
              error ? 'border-saul-crimson/50' : 'border-white/10 focus-within:border-saul-gold/40'
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
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'sub-token-error' : undefined}
              className="mono min-w-0 flex-1 rounded-xl bg-transparent px-3 py-2.5 text-left text-[13px] tracking-wide text-slate-100 outline-none placeholder:text-slate-600"
            />
            <button type="submit" className="btn btn-gold shrink-0 !rounded-xl text-[12px]">
              <BoltIcon className="h-3.5 w-3.5" />
              مشاهده اشتراک
            </button>
          </div>

          {error ? (
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
