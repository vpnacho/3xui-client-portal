import { useNow } from '../hooks/useNow';
import { ClockIcon, InfinityIcon } from './Icons';

const pad = (value) => String(value).padStart(2, '0');

function splitRemaining(expiryTime, now) {
  const diff = Math.max(0, expiryTime - now);
  const totalSeconds = Math.floor(diff / 1000);
  return {
    expired: diff === 0,
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

function Cell({ value, label, tone = 'default' }) {
  const styles =
    tone === 'danger'
      ? 'border-saul-crimson/35 bg-saul-crimson/10 text-rose-200'
      : 'border-white/10 bg-white/[0.045] text-white';
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className={`mono flex h-12 w-12 items-center justify-center rounded-xl border text-lg font-extrabold tracking-tight sm:h-14 sm:w-14 sm:text-xl ${styles}`}
      >
        {value}
      </div>
      <span className="text-[10px] font-medium tracking-wider text-slate-300">{label}</span>
    </div>
  );
}

/** Live countdown; shows an "unlimited" state for zero expiry. */
export function Countdown({ expiryTime, enable }) {
  const unlimited = !expiryTime || expiryTime <= 0;
  const now = useNow(!unlimited);

  if (unlimited) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-saul-gold/20 bg-saul-gold/[0.06] px-4 py-3.5">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-saul-gold/15 text-saul-gold">
          <InfinityIcon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-bold text-saul-amber">اعتبار نامحدود</p>
              <p className="text-[11px] muted">این اشتراک تاریخ انقضا ندارد</p>
        </div>
      </div>
    );
  }

  const { expired, days, hours, minutes, seconds } = splitRemaining(expiryTime, now);
  const urgent = !expired && expiryTime - now < 72 * 3600 * 1000;
  const tone = expired || !enable ? 'danger' : 'default';

  if (expired) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-saul-crimson/35 bg-saul-crimson/10 px-4 py-3.5">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-saul-crimson/20 text-rose-300">
          <ClockIcon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-bold text-rose-200">اشتراک منقضی شده است</p>
          <p className="text-[11px] text-rose-300/70">برای تمدید با پشتیبانی در تماس باشید</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="eyebrow">زمان باقی‌مانده</span>
        {urgent ? (
          <span className="rounded-full bg-saul-crimson/15 px-2.5 py-1 text-[10px] font-bold text-rose-300 ring-1 ring-inset ring-saul-crimson/30">
            کمتر از ۳ روز
          </span>
        ) : null}
      </div>
      <div
        className="flex items-start justify-center gap-1.5 sm:gap-3"
        role="timer"
        aria-live="off"
        aria-label={`${days} روز و ${hours} ساعت باقی‌مانده`}
      >
        <Cell value={String(days)} label="روز" tone={tone} />
        <span className="pt-3 text-base font-bold text-white/25 sm:pt-3.5 sm:text-xl">:</span>
        <Cell value={pad(hours)} label="ساعت" tone={tone} />
        <span className="pt-3 text-base font-bold text-white/25 sm:pt-3.5 sm:text-xl">:</span>
        <Cell value={pad(minutes)} label="دقیقه" tone={tone} />
        <span className="pt-3 text-base font-bold text-white/25 sm:pt-3.5 sm:text-xl">:</span>
        <Cell value={pad(seconds)} label="ثانیه" tone={tone} />
      </div>
    </div>
  );
}
