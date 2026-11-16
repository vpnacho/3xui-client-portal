import { useCallback, useMemo, useState } from 'react';
import { CheckIcon, CopyIcon, LinkIcon } from './Icons';
import { copyText } from '../lib/clipboard';
import { formatCount } from '../lib/format';
import { useToast } from './Toast';

const protocolTone = {
  vless: 'text-saul-gold border-saul-gold/30 bg-saul-gold/10',
  vmess: 'text-sky-300 border-sky-400/30 bg-sky-400/10',
  trojan: 'text-rose-300 border-saul-crimson/35 bg-saul-crimson/12',
  shadowsocks: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10',
  ss: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10',
};

function protocolLabel(protocol) {
  const value = String(protocol || '').toLowerCase();
  if (value === 'shadowsocks') return 'SS';
  return value ? value.toUpperCase() : 'CONFIG';
}

/**
 * Scrollable config list with per-item copy and a single "copy all" action.
 * Both write plain URIs, one per line, which every client accepts.
 */
export function ConfigList({ configs = [], subscriptionUrl }) {
  const toast = useToast();
  const [copiedIndex, setCopiedIndex] = useState(-1);
  const [copiedAll, setCopiedAll] = useState(false);

  const usable = useMemo(
    () => configs.filter((config) => config && typeof config.uri === 'string' && config.uri),
    [configs],
  );
  const allText = useMemo(() => usable.map((config) => config.uri).join('\n'), [usable]);

  const copyOne = useCallback(
    async (config, index) => {
      try {
        await copyText(config.uri);
        setCopiedIndex(index);
        toast.push(`کانفیگ «${config.remark || protocolLabel(config.protocol)}» کپی شد`);
        window.setTimeout(() => setCopiedIndex((current) => (current === index ? -1 : current)), 1800);
      } catch {
        toast.push('کپی خودکار ممکن نشد؛ کانفیگ را دستی انتخاب کنید', { tone: 'error' });
      }
    },
    [toast],
  );

  const copyAll = useCallback(async () => {
    try {
      await copyText(allText);
      setCopiedAll(true);
      toast.push(`${formatCount(usable.length)} کانفیگ کپی شد`);
      window.setTimeout(() => setCopiedAll(false), 2200);
    } catch {
      toast.push('کپی خودکار ممکن نشد؛ کانفیگ‌ها را دستی انتخاب کنید', { tone: 'error' });
    }
  }, [allText, toast, usable.length]);

  if (usable.length === 0) {
    return (
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <LinkIcon className="h-3.5 w-3.5 text-saul-gold/70" />
          <p className="eyebrow">کانفیگ‌ها</p>
        </div>
        <p className="rounded-2xl border border-white/[0.07] bg-white/[0.03] px-4 py-3 text-[11px] muted">
          کانفیگی برای این اشتراک یافت نشد. از لینک اشتراک زیر استفاده کنید.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <LinkIcon className="h-3.5 w-3.5 text-saul-gold/70" />
          <p className="eyebrow">کانفیگ‌ها</p>
          <span
            dir="ltr"
            className="mono rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[9.5px] font-bold tabular-nums text-slate-300"
          >
            {formatCount(usable.length)}
          </span>
        </div>

        <button
          type="button"
          onClick={copyAll}
          className={`btn !px-3 !py-1.5 text-[11px] ${
            copiedAll ? 'btn-ghost !border-emerald-400/30 !text-emerald-300' : 'btn-gold'
          }`}
        >
          {copiedAll ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
          {copiedAll ? 'همه کپی شد' : 'کپی همه کانفیگ‌ها'}
        </button>
      </div>

      <ul className="config-scroll max-h-64 space-y-1.5 overflow-y-auto pl-1 pr-1">
        {usable.map((config, index) => {
          const copied = copiedIndex === index;
          const tone = protocolTone[config.protocol] || 'text-slate-300 border-white/10 bg-white/[0.05]';
          return (
            <li
              key={`${config.remark}-${config.port}-${index}`}
              className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.028] px-3 py-2.5 transition hover:border-saul-gold/25 hover:bg-white/[0.05]"
            >
              <span
                dir="ltr"
                className={`mono shrink-0 rounded-md border px-1.5 py-0.5 text-[9.5px] font-bold tracking-wide ${tone}`}
              >
                {protocolLabel(config.protocol)}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-semibold text-slate-200">
                  {config.remark || 'بدون نام'}
                </p>
                <p dir="ltr" className="mono truncate text-left text-[9.5px] text-slate-500">
                  {config.network}
                  {config.security && config.security !== 'none' ? ` · ${config.security}` : ''}
                </p>
              </div>

              <button
                type="button"
                onClick={() => copyOne(config, index)}
                className={`btn shrink-0 !rounded-lg !px-2.5 !py-1.5 text-[10.5px] ${
                  copied ? 'btn-ghost !border-emerald-400/30 !text-emerald-300' : 'btn-ghost'
                }`}
                aria-label={`کپی کانفیگ ${config.remark || protocolLabel(config.protocol)}`}
              >
                {copied ? <CheckIcon className="h-3 w-3" /> : <CopyIcon className="h-3 w-3" />}
                {copied ? 'کپی شد' : 'کپی'}
              </button>
            </li>
          );
        })}
      </ul>

      {subscriptionUrl ? (
        <p className="text-[9.5px] muted-dim">
          برای افزودن همه کانفیگ‌ها در یک مرحله، از لینک اشتراک استفاده کنید.
        </p>
      ) : null}
    </section>
  );
}
