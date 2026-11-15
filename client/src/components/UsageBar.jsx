import { clamp } from '../lib/format';

const toneByRatio = (ratio) => {
  if (ratio >= 0.95) return { bar: 'crimson', glow: 'rgba(200,16,46,0.55)' };
  if (ratio >= 0.75) return { bar: 'amber', glow: 'rgba(255,120,60,0.5)' };
  return { bar: 'gold', glow: 'rgba(245,197,24,0.55)' };
};

/** Segmented usage meter with a moving highlight and a low-ink fallback. */
export function UsageBar({ used, total }) {
  const ratio = total > 0 ? clamp(used / total, 0, 1) : 0;
  const percent = Math.round(ratio * 1000) / 10;
  const tone = toneByRatio(ratio);

  const fillStyle =
    tone.bar === 'crimson'
      ? 'linear-gradient(90deg, #8f0b22 0%, #c8102e 55%, #ff3b57 100%)'
      : tone.bar === 'amber'
        ? 'linear-gradient(90deg, #b4820a 0%, #f5a318 60%, #ffc55c 100%)'
        : 'linear-gradient(90deg, #b8890a 0%, #f5c518 55%, #ffe071 100%)';

  return (
    <div className="space-y-2">
      <div
        className="relative h-3 w-full overflow-hidden rounded-full bg-white/[0.06] ring-1 ring-inset ring-white/10"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-label="حجم مصرف‌شده"
      >
        {/* Tick marks give the bar a measured, instrument-like feel. */}
        <div className="pointer-events-none absolute inset-0 flex justify-between px-[2px]">
          {Array.from({ length: 24 }).map((_, index) => (
            <span key={index} className="w-px bg-black/25" />
          ))}
        </div>

        <div
          className="relative h-full rounded-full transition-[width] duration-700 ease-out"
          style={{
            width: `${Math.max(ratio > 0 ? 2.5 : 0, ratio * 100)}%`,
            background: fillStyle,
            boxShadow: `0 0 18px ${tone.glow}, 0 0 6px ${tone.glow}`,
          }}
        >
          <div
            className="absolute inset-0 rounded-full opacity-45 animate-shimmer"
            style={{
              backgroundImage:
                'linear-gradient(100deg, transparent 20%, rgba(255,255,255,0.75) 48%, transparent 72%)',
              backgroundSize: '220% 100%',
            }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px]">
        <span className="mono muted">{new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(percent)}٪ مصرف شده</span>
        <span className="mono muted">
          {new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(Math.max(0, 100 - percent))}٪ باقی‌مانده
        </span>
      </div>
    </div>
  );
}
