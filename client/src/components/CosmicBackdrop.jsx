import { useEffect, useRef } from 'react';

const STAR_COLORS = [
  '255, 255, 255',
  '255, 226, 150',
  '198, 214, 255',
  '245, 197, 24',
  '255, 190, 200',
];

/**
 * Canvas starfield with slow parallax drift, occasional shooting stars and a
 * pointer-aware nebula haze. Degrades to a static gradient when reduced motion
 * is requested or the canvas context is unavailable.
 */
export function CosmicBackdrop() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pointer = { x: 0.5, y: 0.4, tx: 0.5, ty: 0.4 };
    let stars = [];
    let meteors = [];
    let frame = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const density = Math.round((width * height) / 9000);
      const count = Math.min(260, Math.max(70, density));
      stars = Array.from({ length: count }, () => makeStar(width, height));
    };

    const makeStar = (w, h) => {
      const depth = Math.random();
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.35 + depth * 1.35,
        depth,
        vx: (Math.random() - 0.5) * (0.03 + depth * 0.07),
        vy: (Math.random() - 0.5) * (0.03 + depth * 0.07),
        color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
        phase: Math.random() * Math.PI * 2,
        twinkle: 0.4 + Math.random() * 1.6,
      };
    };

    const spawnMeteor = () => {
      const startX = Math.random() * width * 0.8 + width * 0.15;
      meteors.push({
        x: startX,
        y: -20,
        vx: -2.6 - Math.random() * 1.8,
        vy: 2.2 + Math.random() * 1.4,
        life: 0,
        maxLife: 90 + Math.random() * 50,
      });
    };

    const drawNebula = () => {
      const blobs = [
        { x: 0.22, y: 0.16, r: 0.55, color: '36, 48, 90', a: 0.4 },
        { x: 0.82, y: 0.1, r: 0.42, color: '96, 22, 44', a: 0.3 },
        { x: 0.55, y: 0.72, r: 0.6, color: '22, 34, 66', a: 0.34 },
        { x: 0.08, y: 0.82, r: 0.4, color: '110, 82, 16', a: 0.16 },
      ];

      for (const blob of blobs) {
        const px = (blob.x + (pointer.x - 0.5) * 0.05) * width;
        const py = (blob.y + (pointer.y - 0.5) * 0.05) * height;
        const radius = Math.max(width, height) * blob.r;
        const gradient = ctx.createRadialGradient(px, py, 0, px, py, radius);
        gradient.addColorStop(0, `rgba(${blob.color}, ${blob.a})`);
        gradient.addColorStop(0.45, `rgba(${blob.color}, ${blob.a * 0.35})`);
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }
    };

    const render = (time) => {
      frame = window.requestAnimationFrame(render);

      pointer.x += (pointer.tx - pointer.x) * 0.045;
      pointer.y += (pointer.ty - pointer.y) * 0.045;

      ctx.clearRect(0, 0, width, height);
      drawNebula();

      const t = time / 1000;
      const offsetX = (pointer.x - 0.5) * 26;
      const offsetY = (pointer.y - 0.5) * 18;

      for (const star of stars) {
        star.x += star.vx;
        star.y += star.vy;

        if (star.x < -2) star.x = width + 2;
        if (star.x > width + 2) star.x = -2;
        if (star.y < -2) star.y = height + 2;
        if (star.y > height + 2) star.y = -2;

        const alpha =
          0.35 +
          star.depth * 0.45 +
          Math.sin(t * star.twinkle + star.phase) * 0.22;
        const x = star.x + offsetX * star.depth;
        const y = star.y + offsetY * star.depth;

        if (star.r > 1.1) {
          const glow = ctx.createRadialGradient(x, y, 0, x, y, star.r * 6);
          glow.addColorStop(0, `rgba(${star.color}, ${alpha * 0.5})`);
          glow.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(x, y, star.r * 6, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = `rgba(${star.color}, ${Math.min(1, alpha)})`;
        ctx.beginPath();
        ctx.arc(x, y, star.r, 0, Math.PI * 2);
        ctx.fill();
      }

      if (Math.random() < 0.0035 && meteors.length < 2) spawnMeteor();

      for (const meteor of meteors) {
        meteor.x += meteor.vx;
        meteor.y += meteor.vy;
        meteor.life += 1;

        const fade = 1 - meteor.life / meteor.maxLife;
        const tailX = meteor.x - meteor.vx * 12;
        const tailY = meteor.y - meteor.vy * 12;
        const trail = ctx.createLinearGradient(meteor.x, meteor.y, tailX, tailY);
        trail.addColorStop(0, `rgba(255, 245, 205, ${0.85 * fade})`);
        trail.addColorStop(1, 'rgba(255, 245, 205, 0)');

        ctx.strokeStyle = trail;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(meteor.x, meteor.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();
      }
      meteors = meteors.filter(
        (meteor) =>
          meteor.life < meteor.maxLife &&
          meteor.y < height + 60 &&
          meteor.x > -60,
      );
    };

    const onPointerMove = (event) => {
      pointer.tx = event.clientX / window.innerWidth;
      pointer.ty = event.clientY / window.innerHeight;
    };

    resize();
    window.addEventListener('resize', resize);

    if (reduced) {
      // Single static frame: stars only, no animation loop.
      drawNebula();
      for (const star of stars) {
        ctx.fillStyle = `rgba(${star.color}, 0.55)`;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      window.addEventListener('pointermove', onPointerMove, { passive: true });
      frame = window.requestAnimationFrame(render);
    }

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <canvas ref={canvasRef} className="h-full w-full opacity-90" />

      {/* Soft vignette keeps the cards readable without hiding the field. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_0%,rgba(9,11,16,0.35)_55%,rgba(9,11,16,0.92)_100%)]" />

      <div className="absolute -top-32 right-1/2 h-[34rem] w-[34rem] translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(245,197,24,0.10),transparent_65%)] blur-2xl animate-pulseGlow" />
      <div className="absolute -bottom-40 left-[-10rem] h-[30rem] w-[30rem] rounded-full bg-[radial-gradient(circle,rgba(200,16,46,0.14),transparent_62%)] blur-3xl animate-drift" />
      <div className="absolute top-1/3 right-[-12rem] h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(circle,rgba(70,98,180,0.14),transparent_60%)] blur-3xl animate-drift-slow" />

      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
    </div>
  );
}
