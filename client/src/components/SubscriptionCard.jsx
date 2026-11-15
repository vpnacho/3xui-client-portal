import { useCallback, useMemo, useState } from 'react';
import { AppLinkButton } from './AppLinkButton';
import { Countdown } from './Countdown';
import { Modal } from './Modal';
import { QrCode } from './QrCode';
import { StatTile } from './StatTile';
import { StatusBadge } from './StatusBadge';
import { UsageBar } from './UsageBar';
import { useToast } from './Toast';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BoltIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  DownloadIcon,
  LinkIcon,
  QrIcon,
} from './Icons';
import { formatBytesShort, formatDate, formatSize, formatSizeText } from '../lib/format';
import { importApps } from '../lib/links';

function subscriptionState(client) {
  if (!client.enable) return 'disabled';
  if (client.expiryTime > 0 && client.expiryTime <= Date.now()) return 'expired';
  return 'active';
}

export function SubscriptionCard({ client }) {
  const toast = useToast();
  const [qrOpen, setQrOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const used = Math.max(0, client.upload + client.download);
  const total = Math.max(0, client.total);
  const remaining = total > 0 ? Math.max(0, total - used) : 0;
  const state = subscriptionState(client);

  const usedFormatted = formatSize(used);
  const remainFormatted = formatSize(remaining);
  const totalFormatted = formatSize(total);

  const copy = useCallback(async () => {
    const url = client.subscriptionUrl;
    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
      } else {
        const area = document.createElement('textarea');
        area.value = url;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(area);
        if (!ok) throw new Error('copy failed');
      }
      setCopied(true);
      toast.push('لینک اشتراک کپی شد');
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      toast.push('کپی خودکار ممکن نشد؛ لینک را دستی انتخاب کنید', { tone: 'error' });
    }
  }, [client.subscriptionUrl, toast]);

  const onDesktopFallback = useCallback(
    (app) => {
      copy();
      toast.push(`ممکن است ${app.name} نصب نباشد — لینک کپی شد`, { tone: 'error' });
    },
    [copy, toast],
  );

  const stats = useMemo(
    () => [
      {
        label: 'آپلود',
        value: formatBytesShort(client.upload),
        icon: <ArrowUpIcon className="h-3.5 w-3.5" />,
        accent: 'default',
      },
      {
        label: 'دانلود',
        value: formatBytesShort(client.download),
        icon: <ArrowDownIcon className="h-3.5 w-3.5" />,
        accent: 'default',
      },
      {
        label: 'حجم کل',
        value: total > 0 ? totalFormatted.value : '∞',
        unit: total > 0 ? totalFormatted.unit : '',
        icon: <BoltIcon className="h-3.5 w-3.5" />,
        accent: 'gold',
      },
      {
        label: 'تاریخ انقضا',
        value: client.expiryTime > 0 ? formatDate(client.expiryTime) : 'نامحدود',
        icon: <ClockIcon className="h-3.5 w-3.5" />,
        accent: client.expiryTime > 0 && client.expiryTime <= Date.now() ? 'crimson' : 'muted',
        wide: true,
      },
    ],
    [client.upload, client.download, client.expiryTime, total, totalFormatted.value, totalFormatted.unit],
  );

  return (
    <>
      <article className="glass grain hairline-gold relative overflow-hidden rounded-[28px]">
        {/* Corner light leak keeps the card from feeling flat. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -left-16 h-56 w-56 rounded-full bg-saul-gold/10 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-28 -right-20 h-64 w-64 rounded-full bg-saul-crimson/10 blur-3xl"
        />

        <div className="relative p-6 sm:p-8">
          {/* Header ------------------------------------------------------- */}
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-saul-gold/15 text-saul-gold ring-1 ring-inset ring-saul-gold/25">
                  <BoltIcon className="h-3.5 w-3.5" />
                </span>
                <p className="eyebrow text-saul-gold/80">3X-UI · ACCESS KEY</p>
              </div>
              <h1 className="truncate text-2xl font-extrabold leading-tight text-white text-glow-gold sm:text-[28px]">
                {client.email || 'اشتراک من'}
              </h1>
              <p className="mt-1.5 text-xs muted">
                کلید دسترسی اختصاصی شما — این صفحه فقط اطلاعات همین اشتراک را نمایش می‌دهد
              </p>
            </div>
            <StatusBadge state={state} />
          </header>

          <div className="divider my-6" />

          {/* Usage -------------------------------------------------------- */}
          <section className="space-y-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="eyebrow mb-1">مصرف‌شده</p>
                <p className="mono text-3xl font-extrabold leading-none text-white">
                  {usedFormatted.value}
                  <span className="mr-1.5 text-sm font-bold muted">{usedFormatted.unit}</span>
                </p>
              </div>
              <div className="text-left">
                <p className="eyebrow mb-1">از مجموع</p>
                <p className="mono text-sm font-bold muted">
                  {total > 0 ? formatSizeText(total) : 'نامحدود'}
                </p>
              </div>
            </div>

            <UsageBar used={used} total={total} />

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3.5 py-2.5">
                <p className="text-[10px] font-semibold muted">باقی‌مانده</p>
                <p className="mono mt-0.5 text-base font-extrabold text-saul-gold">
                  {total > 0 ? `${remainFormatted.value} ${remainFormatted.unit}` : '∞'}
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3.5 py-2.5">
                <p className="text-[10px] font-semibold muted">مجموع</p>
                <p className="mono mt-0.5 text-base font-extrabold text-slate-200">
                  {total > 0 ? `${totalFormatted.value} ${totalFormatted.unit}` : '∞'}
                </p>
              </div>
            </div>
          </section>

          <div className="divider my-6" />

          {/* Countdown ---------------------------------------------------- */}
          <Countdown expiryTime={client.expiryTime} enable={client.enable} />

          <div className="divider my-6" />

          {/* Detail tiles -------------------------------------------------- */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label} className={stat.wide ? 'col-span-2' : ''}>
                <StatTile
                  icon={stat.icon}
                  label={stat.label}
                  value={stat.value}
                  unit={stat.unit}
                  accent={stat.accent}
                />
              </div>
            ))}
          </div>

          <div className="divider my-6" />

          {/* Subscription URL --------------------------------------------- */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <LinkIcon className="h-3.5 w-3.5 text-saul-gold/70" />
              <p className="eyebrow">لینک اشتراک</p>
            </div>

            <div className="group flex items-stretch gap-2 rounded-2xl border border-white/10 bg-void-900/70 p-1.5 transition focus-within:border-saul-gold/40">
              <code
                dir="ltr"
                className="min-w-0 flex-1 self-center truncate px-2 text-left font-mono text-[11px] text-slate-400"
                title={client.subscriptionUrl}
              >
                {client.subscriptionUrl}
              </code>
              <button
                type="button"
                onClick={copy}
                className={`btn shrink-0 !rounded-xl !px-3 !py-2 text-[11px] ${
                  copied ? 'btn-crimson !border-emerald-400/30 !bg-emerald-400/10 !text-emerald-300' : 'btn-gold'
                }`}
              >
                {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
                {copied ? 'کپی شد' : 'کپی'}
              </button>
            </div>

            <div className="flex gap-2">
              <button type="button" onClick={copy} className="btn btn-ghost flex-1 text-[12px]">
                <CopyIcon className="h-3.5 w-3.5" />
                کپی لینک اشتراک
              </button>
              <button
                type="button"
                onClick={() => setQrOpen(true)}
                className="btn btn-ghost flex-1 text-[12px]"
              >
                <QrIcon className="h-3.5 w-3.5" />
                نمایش QR
              </button>
            </div>
          </section>

          <div className="divider my-6" />

          {/* One-tap imports ---------------------------------------------- */}
          <section className="space-y-3">
            <div className="flex items-baseline justify-between">
              <p className="eyebrow">افزودن یک‌کلیکی</p>
              <span className="text-[10px] muted-dim">اپلیکیشن خود را انتخاب کنید</span>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {importApps.map((app) => (
                <AppLinkButton
                  key={app.id}
                  app={app}
                  subscriptionUrl={client.subscriptionUrl}
                  onCopyFallback={onDesktopFallback}
                />
              ))}
            </div>

            {client.vlessUri ? (
              <a
                href={client.vlessUri}
                className="btn btn-ghost w-full !border-saul-gold/25 !bg-saul-gold/[0.06] text-[12px] !text-saul-amber hover:!bg-saul-gold/[0.12]"
              >
                <DownloadIcon className="h-3.5 w-3.5" />
                افزودن مستقیم کانفیگ VLESS
              </a>
            ) : null}
          </section>
        </div>
      </article>

      <Modal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        title="اسکن اشتراک"
        description="با دوربین گوشی اسکن کنید تا لینک در اپلیکیشن کلاینت اضافه شود."
      >
        <div className="flex flex-col items-center gap-5">
          <QrCode value={client.subscriptionUrl} />
          <p className="mono w-full break-all rounded-xl border border-white/10 bg-void-900/60 px-3 py-2 text-center text-[10px] text-slate-400" dir="ltr">
            {client.subscriptionUrl}
          </p>
          <button type="button" onClick={copy} className="btn btn-gold w-full">
            <CopyIcon className="h-4 w-4" />
            کپی لینک اشتراک
          </button>
        </div>
      </Modal>
    </>
  );
}
