import { useEffect, useRef } from 'react';
import type { RainLevel } from './RainIntensity';

const BANDS = [
  { speed: 420, length: 14, width: 0.8, opacity: 0.28, share: 0.46 },
  { speed: 660, length: 23, width: 1.05, opacity: 0.40, share: 0.36 },
  { speed: 920, length: 34, width: 1.35, opacity: 0.50, share: 0.18 },
];
const DENSITY = [0.44, 0.74, 1];
const WIND = 0.2;
const MARGIN = 48;

export function RainOverlay({ active, intensity }: { active: boolean; intensity: RainLevel }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const weather = useRef({ active, intensity });
  const wake = useRef<() => void>(() => {});
  weather.current = { active, intensity };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0;
    let height = 0;
    let drops: { x: number; y: number; scale: number }[][] = [];
    let veil: CanvasGradient;
    let frame = 0;
    let last = 0;
    let strength = 0;
    let density = DENSITY[weather.current.intensity];

    const draw = (now: number) => {
      frame = 0;
      const dt = Math.max(0, Math.min((now - last) / 1000, 0.05));
      last = now;
      const { active, intensity } = weather.current;
      const target = active ? 1 : 0;
      strength += (target - strength) * (1 - Math.exp(-dt * (active ? 7 : 4)));
      density += (DENSITY[intensity] - density) * (1 - Math.exp(-dt * 7));
      if (motion.matches) {
        strength = target;
        density = DENSITY[intensity];
      }

      ctx.clearRect(0, 0, width, height);
      if (strength <= 0.01 && !active) {
        strength = 0;
        return;
      }

      ctx.globalAlpha = strength * density;
      ctx.fillStyle = veil;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;

      if (!motion.matches) {
        for (const [index, band] of BANDS.entries()) {
          const streaks = drops[index];
          const count = Math.min(streaks.length, Math.ceil(streaks.length * density));
          ctx.lineWidth = band.width;
          ctx.strokeStyle = `rgba(171, 208, 248, ${band.opacity * strength})`;
          ctx.beginPath();
          for (let i = 0; i < count; i++) {
            const streak = streaks[i];
            const fall = band.speed * streak.scale * dt;
            streak.y += fall;
            streak.x += fall * WIND;
            if (streak.y > height + MARGIN) {
              streak.y = -MARGIN;
              streak.x = Math.random() * (width + MARGIN) - MARGIN;
            } else if (streak.x > width + MARGIN) {
              streak.x = -MARGIN;
            }
            const length = band.length * streak.scale;
            ctx.moveTo(streak.x, streak.y);
            ctx.lineTo(streak.x - length * WIND, streak.y - length);
          }
          ctx.stroke();
        }
        frame = requestAnimationFrame(draw);
      }
    };

    const start = () => {
      if (frame) return;
      last = performance.now();
      frame = requestAnimationFrame(draw);
    };
    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      const scale = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.lineCap = 'round';
      veil = ctx.createLinearGradient(0, 0, 0, Math.max(1, height));
      veil.addColorStop(0, 'rgba(77, 113, 159, 0.2)');
      veil.addColorStop(1, 'rgba(30, 54, 84, 0.03)');
      const count = Math.min(410, Math.max(90, Math.round(width * height / 3400)));
      drops = BANDS.map(({ share }) => Array.from({ length: Math.ceil(count * share) }, () => ({
        x: Math.random() * (width + MARGIN * 2) - MARGIN,
        y: Math.random() * (height + MARGIN * 2) - MARGIN,
        scale: 0.72 + Math.random() * 0.58,
      })));
      start();
    };

    wake.current = start;
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    motion.addEventListener('change', start);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      motion.removeEventListener('change', start);
      wake.current = () => {};
    };
  }, []);

  useEffect(() => wake.current(), [active, intensity]);

  return <canvas ref={canvasRef} className="rain-canvas" aria-hidden="true" />;
}
