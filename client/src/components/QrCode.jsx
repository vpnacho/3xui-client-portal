import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

/**
 * Renders a QR code locally (no third-party request, so the token never leaves
 * the browser). Draws on a canvas with a quiet zone sized for phone scanners.
 */
export function QrCode({ value, size = 232 }) {
  const canvasRef = useRef(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!value) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      QRCode.toCanvas(canvas, value, {
        width: size,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#090B10', light: '#F7F5EE' },
      });
      setError(false);
    } catch {
      setError(true);
    }
  }, [value, size]);

  if (error) {
    return (
      <div className="grid h-[232px] w-[232px] place-items-center rounded-2xl border border-white/10 bg-white/5 text-center text-xs text-slate-400">
        ساخت QR ناموفق بود
      </div>
    );
  }

  return (
    <div className="relative rounded-2xl bg-[#F7F5EE] p-3 shadow-[0_0_60px_-16px_rgba(245,197,24,0.55)]">
      <span className="pointer-events-none absolute -top-2 -right-2 h-5 w-5 rounded-tr-md border-t-2 border-r-2 border-saul-gold" />
      <span className="pointer-events-none absolute -top-2 -left-2 h-5 w-5 rounded-tl-md border-t-2 border-l-2 border-saul-gold" />
      <span className="pointer-events-none absolute -bottom-2 -right-2 h-5 w-5 rounded-br-md border-b-2 border-r-2 border-saul-gold" />
      <span className="pointer-events-none absolute -bottom-2 -left-2 h-5 w-5 rounded-bl-md border-b-2 border-l-2 border-saul-gold" />
      <canvas ref={canvasRef} width={size} height={size} className="block h-auto w-full rounded-lg" />
    </div>
  );
}
