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
    <div className="glass-soft group relative overflow-hidden rounded-2xl px-4 py-3.5 transition hover:border-white/12 hover:bg-white/[0.055]">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-lg bg-white/[0.05] text-slate-400">
          {icon}
        </span>
        <span className="text-[10.5px] font-semibold tracking-wide muted">{label}</span>
      </div>
      {/* Numbers are always LTR + tabular-nums to prevent wrapping. */}
      <div
        dir="ltr"
        className="flex items-baseline gap-1 overflow-hidden whitespace-nowrap"
      >
        <span
          className={`mono text-2xl font-extrabold leading-none tabular-nums ${accents[accent]}`}
        >
          {value}
        </span>
        {unit ? (
          <span className="text-[11px] font-semibold muted whitespace-nowrap">{unit}</span>
        ) : null}
      </div>
    </div>
  );
}
