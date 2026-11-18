import { useEffect, useRef } from 'react';

interface Drop {
  x: number;
  y: number;
  len: number;
  speed: number;
  alpha: number;
  depth: number;
}
interface Splash {
  x: number;
  y: number;
  r: number;
  life: number;
}

/**
 * Screen-space animated rainfall drawn on a canvas above the map. Purely visual — it does not
 * block map interaction (pointer-events: none). Fades in / out smoothly.
 */
/** Share of drops shown per intensity (Gentle / Moderate / Heavy). Visual density only. */
const DENSITY = [0.35, 0.65, 1];

export function RainOverlay({ active, bearing, intensity = 1 }: { active: boolean; bearing: number; intensity?: 0 | 1 | 2 }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active);
  const bearingRef = useRef(bearing);
  const kickRef = useRef<() => void>(() => {});
  activeRef.current = active;
  bearingRef.current = bearing;
  const intensityRef = useRef(intensity);
  intensityRef.current = intensity;

  useEffect(() => {
    if (active) kickRef.current();
  }, [active]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let level = 0; // 0..1 fade
    let drops: Drop[] = [];
    const splashes: Splash[] = [];
    let last = performance.now();
    let running = false;

    const makeDrop = (randomY: boolean): Drop => {
      const depth = Math.random();
      return {
        x: Math.random() * (w + 200) - 100,
        y: randomY ? Math.random() * h : -40 - Math.random() * 200,
        len: 10 + depth * 22,
        speed: 700 + depth * 900,
        alpha: 0.12 + depth * 0.38,
        depth,
      };
    };

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(Math.min(900, (w * h) / 1700));
      drops = Array.from({ length: count }, () => makeDrop(true));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      level += ((activeRef.current ? 1 : 0) - level) * Math.min(1, dt * 1.6);

      ctx.clearRect(0, 0, w, h);
      if (level > 0.003) {
        // wind slant follows map rotation a little, for a sense of "weather in the world"
        const wind = 0.16 + Math.sin((bearingRef.current * Math.PI) / 180) * 0.08;
        // wet atmospheric veil
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, `rgba(30,52,86,${0.22 * level})`);
        g.addColorStop(1, `rgba(8,14,26,${0.12 * level})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);

        ctx.lineCap = 'round';
        const visible = Math.floor(drops.length * level * DENSITY[intensityRef.current]);
        for (let i = 0; i < drops.length; i++) {
          const d = drops[i];
          d.y += d.speed * dt;
          d.x += d.speed * wind * dt;
          if (d.y > h * (0.55 + d.depth * 0.45)) {
            if (i < visible && Math.random() < 0.35) {
              splashes.push({ x: d.x, y: d.y, r: 0, life: 1 });
            }
            Object.assign(d, makeDrop(false));
          }
          if (i >= visible) continue;
          ctx.strokeStyle = `rgba(170,205,255,${d.alpha * level})`;
          ctx.lineWidth = 0.6 + d.depth * 0.9;
          ctx.beginPath();
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x - d.len * wind, d.y - d.len);
          ctx.stroke();
        }

        for (let i = splashes.length - 1; i >= 0; i--) {
          const s = splashes[i];
          s.life -= dt * 2.4;
          s.r += dt * 26;
          if (s.life <= 0) {
            splashes.splice(i, 1);
            continue;
          }
          ctx.strokeStyle = `rgba(150,200,255,${0.35 * s.life * level})`;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.ellipse(s.x, s.y, s.r, s.r * 0.35, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (splashes.length > 400) splashes.splice(0, splashes.length - 400);
      }
      if (!activeRef.current && level <= 0.003) {
        running = false; // idle: stop the loop until rain is switched on again
        ctx.clearRect(0, 0, w, h);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    kickRef.current = () => {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    if (activeRef.current) kickRef.current();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="rain-canvas" aria-hidden="true" />;
}
