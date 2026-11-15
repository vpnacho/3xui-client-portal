import { useEffect, useState } from 'react';

/** A ticking clock, paused while the tab is hidden to save battery. */
export function useNow(active = true, intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return undefined;

    let timer = null;
    const tick = () => setNow(Date.now());
    const start = () => {
      tick();
      timer = window.setInterval(tick, intervalMs);
    };
    const stop = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, intervalMs]);

  return now;
}
