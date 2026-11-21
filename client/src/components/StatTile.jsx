/**
 * Stat tile with LTR number + unit layout so the number never wraps onto a
 * second line regardless of the viewport width.
 */
export function StatTile({ icon, label, value, unit, accent = 'default' }) {
  const accents = {
    default: 'text-slate-100',
    gold: 'text-saul-gold',
    crimson: 'text-rose-300',
    muted: 'text-slate-400',
  };

  return (
    <div className="glass-soft group relative min-w-0 overflow-hidden rounded-2xl px-3 py-3.5 sm:px-4 transition hover:border-white/12 hover:bg-white/[0.055]">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-slate-400">
          {icon}
        </span>
        <span className="truncate text-[10.5px] font-semibold tracking-wide muted">{label}</span>
      </div>
      {/* Numbers are always LTR + tabular-nums to prevent wrapping. */}
      <div
        dir="ltr"
        className="flex min-w-0 items-baseline gap-1 overflow-hidden whitespace-nowrap"
      >
        <span
          className={`mono min-w-0 shrink text-xl font-extrabold leading-none tabular-nums sm:text-2xl ${accents[accent]}`}
        >
          {value}
        </span>
        {unit ? (
          <span className="shrink-0 text-[11px] font-semibold muted whitespace-nowrap">{unit}</span>
        ) : null}
      </div>
    </div>
  );
}
