import { AlertIcon, ShieldIcon } from './Icons';

const states = {
  active: {
    label: 'فعال',
    dot: 'bg-emerald-400',
    ping: 'bg-emerald-400/40',
    ring: 'ring-emerald-400/30',
    text: 'text-emerald-300',
    bg: 'bg-emerald-400/10',
    halo: 'shadow-[0_0_22px_-4px_rgba(52,211,153,0.65)]',
    Icon: ShieldIcon,
  },
  disabled: {
    label: 'غیرفعال',
    dot: 'bg-saul-crimson',
    ping: 'bg-saul-crimson/45',
    ring: 'ring-saul-crimson/35',
    text: 'text-rose-300',
    bg: 'bg-saul-crimson/12',
    halo: 'shadow-[0_0_22px_-4px_rgba(200,16,46,0.7)]',
    Icon: AlertIcon,
  },
  expired: {
    label: 'منقضی‌شده',
    dot: 'bg-saul-crimson',
    ping: 'bg-saul-crimson/45',
    ring: 'ring-saul-crimson/35',
    text: 'text-rose-300',
    bg: 'bg-saul-crimson/12',
    halo: 'shadow-[0_0_22px_-4px_rgba(200,16,46,0.7)]',
    Icon: AlertIcon,
  },
};

export function StatusBadge({ state }) {
  const style = states[state] ?? states.disabled;
  const { Icon } = style;

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold ring-1 ring-inset ${style.bg} ${style.ring} ${style.text} ${style.halo}`}
    >
      <span className="dot" data-tone={style.dot}>
        <span className="absolute inset-0 overflow-hidden rounded-full">
          <span className={`animate-ping absolute inset-0 rounded-full ${style.ping}`} />
        </span>
        <span className={`absolute inset-0 rounded-full ${style.dot}`} />
      </span>
      <Icon className="h-3.5 w-3.5" />
      {style.label}
    </span>
  );
}
