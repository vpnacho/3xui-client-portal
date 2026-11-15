import { useEffect, useRef } from 'react';
import { CloseIcon } from './Icons';

/** Focus-trapped, Escape-dismissable dialog used for the QR sheet. */
export function Modal({ open, title, description, onClose, children }) {
  const panelRef = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocused.current = document.activeElement;
    const panel = panelRef.current;
    panel?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;

      const focusable = panel.querySelectorAll(
        'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" dir="rtl">
      <div
        className="absolute inset-0 bg-void-900/80 backdrop-blur-md animate-riseIn"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="glass grain relative w-full max-w-md rounded-3xl p-6 outline-none animate-riseIn"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow mb-1.5 text-saul-gold/80">QR • اسکن سریع</p>
            <h2 className="text-lg font-extrabold text-white">{title}</h2>
            {description ? (
              <p className="mt-1 text-xs leading-6 text-slate-400">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost h-9 w-9 shrink-0 rounded-full !p-0"
            aria-label="بستن"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
