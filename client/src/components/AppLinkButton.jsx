import { ArrowUpIcon, DownloadIcon, LinkIcon, SignalIcon } from './Icons';

const icons = {
  happ: ArrowUpIcon,
  karing: LinkIcon,
  streisand: DownloadIcon,
  v2rayng: SignalIcon,
};

/** One-tap deep link into a client app; `onCopyFallback` handles desktop misses. */
export function AppLinkButton({ app, subscriptionUrl, onCopyFallback }) {
  const Icon = icons[app.id] ?? LinkIcon;
  const href = app.build(subscriptionUrl);

  return (
    <a
      href={href}
      onClick={() => {
        // Desktop browsers often refuse custom schemes; copy the sub URL so the
        // user still ends up with something usable.
        const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
        if (!isMobile) window.setTimeout(() => onCopyFallback?.(app), 250);
      }}
      className="group relative flex items-center gap-3 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] px-3.5 py-3 transition duration-200 hover:-translate-y-0.5 hover:border-saul-gold/40 hover:bg-saul-gold/[0.07]"
      rel="noopener noreferrer"
      aria-label={`افزودن اشتراک به ${app.name}`}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-void-800/80 text-slate-300 transition group-hover:border-saul-gold/40 group-hover:text-saul-gold">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1 text-right">
        <span className="block text-[13px] font-bold text-slate-100">{app.name}</span>
        <span className="block truncate text-[10px] muted">{app.hint}</span>
      </span>
      <span className="text-[10px] font-bold text-saul-gold/0 transition group-hover:text-saul-gold/80">
        افزودن
      </span>
    </a>
  );
}
