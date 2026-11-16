import { AlertIcon } from './Icons';

/** Glass card with a gold/crimson hairline, driven by `.env` values. */
export function Announcement({ announcement }) {
  if (!announcement?.enabled || !announcement?.text) return null;

  return (
    <section
      aria-label={announcement.title || 'اطلاعیه'}
      className="glass relative overflow-hidden rounded-2xl p-4 sm:p-5"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 w-[3px] bg-gradient-to-b from-saul-gold via-saul-amber/70 to-saul-crimson"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-16 -left-10 h-40 w-40 rounded-full bg-saul-gold/10 blur-3xl"
      />

      <div className="relative flex gap-3">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-saul-gold/30 bg-saul-gold/12 text-saul-gold">
          <AlertIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 space-y-1.5">
          {announcement.title ? (
            <p className="text-[13px] font-extrabold text-saul-amber">{announcement.title}</p>
          ) : null}
          <p className="text-[11.5px] leading-6 text-slate-300/90">{announcement.text}</p>
        </div>
      </div>
    </section>
  );
}
