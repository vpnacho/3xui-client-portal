import { SignalIcon } from './Icons';
import { formatCount } from '../lib/format';

/** Live online indicator + per-country connection summary (no IPs exposed). */
export function LiveStatus({ online, connections = 0, countries = [] }) {
  const total = Math.max(0, Number(connections) || 0);

  return (
    <section className="glass-soft space-y-3 rounded-2xl px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="relative inline-flex h-2 w-2 shrink-0">
            {online ? (
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/50" />
            ) : null}
            <span
              className={`relative inline-block h-2 w-2 rounded-full ${
                online
                  ? 'bg-emerald-400 shadow-[0_0_14px_2px_rgba(52,211,153,0.5)]'
                  : 'bg-slate-500'
              }`}
            />
          </span>
          <span
            className={`text-[12px] font-bold ${online ? 'text-emerald-300' : 'text-slate-400'}`}
          >
            {online ? 'آنلاین' : 'آفلاین'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-[10.5px] muted">
          <SignalIcon className="h-3.5 w-3.5 text-saul-gold/70" />
          <span>کلاینت‌های متصل</span>
          <span dir="ltr" className="mono tabular-nums font-bold text-slate-200">
            {formatCount(total)}
          </span>
        </div>
      </div>

      {countries.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {countries.map((country) => (
            <li
              key={country.code}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.03] px-2 py-1 text-[10.5px]"
            >
              <span className="font-semibold text-slate-300">{country.name}</span>
              <span dir="ltr" className="mono tabular-nums text-[10px] font-bold text-saul-gold">
                {formatCount(country.count)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[10.5px] muted-dim">
          {online ? 'در حال حاضر اتصالی از این اشتراک ثبت نشده است.' : 'سابقه‌ای از اتصال ثبت نشده است.'}
        </p>
      )}
    </section>
  );
}
