import { ShieldIcon } from './Icons';

/** Shared footer: security note, refresh cadence and the author watermark. */
export function Footer({ footer, profileUpdateInterval = 12 }) {
  const name = String(footer?.authorName || 'VPNacho').trim();
  const url = String(footer?.authorUrl || '').trim();
  const safeUrl = /^https?:\/\//i.test(url) ? url : '';

  return (
    <footer className="mt-6 flex flex-col items-center gap-2.5 text-center">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-[10px] muted">
        <ShieldIcon className="h-3 w-3 text-emerald-400/70" />
        اتصال امن · بدون ذخیره‌سازی اطلاعات
      </span>

      <p className="text-[10px] muted-dim">
        دوره به‌روزرسانی خودکار پروفایل: هر{' '}
        <span className="mono tabular-nums">{profileUpdateInterval}</span> ساعت
      </p>

      <p className="text-[10px] muted-dim">
        ساخته شده با <span aria-hidden="true" className="text-saul-crimson">❤️</span> توسط{' '}
        {safeUrl ? (
          <a
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-saul-gold/90 underline decoration-saul-gold/30 underline-offset-2 transition hover:text-saul-amber"
          >
            {name}
          </a>
        ) : (
          <span className="font-semibold text-saul-gold/90">{name}</span>
        )}
      </p>
    </footer>
  );
}
