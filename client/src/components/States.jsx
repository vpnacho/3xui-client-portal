import { AlertIcon, BoltIcon, RefreshIcon, SpinnerIcon } from './Icons';

export function LoadingState() {
  return (
    <div className="glass hairline-gold relative overflow-hidden rounded-[28px] p-6 sm:p-8" aria-busy="true">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-3">
          <div className="h-3 w-24 animate-pulse rounded-full bg-white/10" />
          <div className="h-7 w-48 animate-pulse rounded-lg bg-white/10" />
          <div className="h-3 w-64 animate-pulse rounded-full bg-white/[0.07]" />
        </div>
        <div className="h-8 w-24 animate-pulse rounded-full bg-white/10" />
      </div>

      <div className="divider my-6" />

      <div className="space-y-4">
        <div className="flex items-end justify-between">
          <div className="h-9 w-28 animate-pulse rounded-lg bg-white/10" />
          <div className="h-4 w-16 animate-pulse rounded bg-white/[0.07]" />
        </div>
        <div className="h-3 w-full animate-pulse rounded-full bg-white/10" />
      </div>

      <div className="divider my-6" />

      <div className="flex justify-center gap-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-14 w-14 animate-pulse rounded-xl bg-white/10" />
        ))}
      </div>

      <div className="divider my-6" />

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-20 animate-pulse rounded-2xl bg-white/[0.06]" />
        ))}
      </div>

      <p className="mt-6 flex items-center justify-center gap-2 text-[11px] muted">
        <SpinnerIcon className="h-3.5 w-3.5 text-saul-gold" />
        در حال دریافت اطلاعات اشتراک…
      </p>
    </div>
  );
}

export function ErrorState({ kind = 'error', onRetry }) {
  const isNotFound = kind === 'not-found';

  return (
    <div className="glass hairline-gold relative overflow-hidden rounded-[28px] p-8 text-center">
      <div
        aria-hidden="true"
        className={`mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl ring-1 ring-inset ${
          isNotFound
            ? 'bg-saul-crimson/12 text-rose-300 ring-saul-crimson/30 shadow-crimson'
            : 'bg-saul-gold/12 text-saul-gold ring-saul-gold/30'
        }`}
      >
        {isNotFound ? <AlertIcon className="h-7 w-7" /> : <BoltIcon className="h-7 w-7" />}
      </div>

      <h2 className="text-xl font-extrabold text-white">
        {isNotFound ? 'اشتراکی با این شناسه پیدا نشد' : 'ارتباط با سرور برقرار نشد'}
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-xs leading-6 muted">
        {isNotFound
          ? 'لینک اشتراک شما ممکن است منقضی شده یا اشتباه کپی شده باشد. لطفاً لینک را دوباره از پشتیبانی دریافت کنید.'
          : 'اطلاعات اشتراک در حال حاضر در دسترس نیست. چند لحظه دیگر دوباره تلاش کنید یا با پشتیبانی تماس بگیرید.'}
      </p>

      {!isNotFound && onRetry ? (
        <button type="button" onClick={onRetry} className="btn btn-gold mx-auto mt-6">
          <RefreshIcon className="h-4 w-4" />
          تلاش مجدد
        </button>
      ) : null}
    </div>
  );
}
