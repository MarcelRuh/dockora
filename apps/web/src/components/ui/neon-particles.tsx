'use client';

import { useEffect, useRef } from 'react';

type Particle = {
  x: number;
  y: number;
  size: number;
  speedX: number;
  speedY: number;
  opacity: number;
  color: string;
};

const COLORS = [
  'rgba(255,0,110,',
  'rgba(131,56,236,',
  'rgba(0,180,216,',
  'rgba(6,214,160,',
] as const;

/** NeonVerse particle mesh – adapted from CodePen jrck/XJNgxzV */
export function NeonParticles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let running = true;
    let particles: Particle[] = [];

    const resize = () => {
      const parent = canvas.parentElement ?? document.body;
      const w = parent.clientWidth || window.innerWidth;
      const h = parent.clientHeight || window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.min(120, Math.max(40, Math.floor((w * h) / 18000)));
      particles = Array.from({ length: count }, () => createParticle(w, h));
    };

    const createParticle = (w: number, h: number): Particle => ({
      x: Math.random() * w,
      y: Math.random() * h,
      size: Math.random() * 2 + 0.5,
      speedX: (Math.random() - 0.5) * 0.5,
      speedY: (Math.random() - 0.5) * 0.5,
      opacity: Math.random() * 0.5 + 0.1,
      color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
    });

    const draw = () => {
      if (!running) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      for (const p of particles) {
        p.x += p.speedX;
        p.y += p.speedY;
        if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) {
          Object.assign(p, createParticle(w, h));
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `${p.color}${p.opacity})`;
        ctx.fill();
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i]!;
          const b = particles[j]!;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 120) {
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(131,56,236,${0.12 * (1 - dist / 120)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      raf = window.requestAnimationFrame(draw);
    };

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        window.cancelAnimationFrame(raf);
      } else {
        running = true;
        raf = window.requestAnimationFrame(draw);
      }
    };

    resize();
    draw();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      running = false;
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 h-full w-full opacity-70 dark:opacity-90"
    />
  );
}

/** Ambient glow orbs + floating geometric shapes (NeonVerse hero atmosphere) */
export function NeonAtmosphere() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div
        className="dockora-glow-orb"
        style={{
          width: 380,
          height: 380,
          background: 'var(--dockora-pink)',
          top: '8%',
          left: '10%',
        }}
      />
      <div
        className="dockora-glow-orb"
        style={{
          width: 280,
          height: 280,
          background: 'var(--dockora-blue)',
          top: '18%',
          right: '12%',
          animationDelay: '-3s',
        }}
      />
      <div
        className="dockora-glow-orb"
        style={{
          width: 320,
          height: 320,
          background: 'var(--dockora-purple)',
          bottom: '8%',
          left: '38%',
          animationDelay: '-5s',
        }}
      />

      <div
        className="absolute border border-[rgba(255,0,110,0.28)]"
        style={{
          width: 72,
          height: 72,
          top: '14%',
          left: '7%',
          transform: 'rotate(45deg)',
          animation: 'dockora-shape-float 12s ease-in-out infinite',
        }}
      />
      <div
        className="absolute rounded-full border border-[rgba(0,180,216,0.28)]"
        style={{
          width: 56,
          height: 56,
          top: '22%',
          right: '10%',
          animation: 'dockora-shape-float 15s ease-in-out infinite',
          animationDelay: '-2s',
        }}
      />
      <div
        className="absolute border border-[rgba(131,56,236,0.28)]"
        style={{
          width: 88,
          height: 88,
          bottom: '18%',
          left: '18%',
          borderRadius: 12,
          animation: 'dockora-shape-float 14s ease-in-out infinite',
          animationDelay: '-4s',
        }}
      />
      <div
        className="absolute border border-[rgba(6,214,160,0.22)]"
        style={{
          width: 48,
          height: 48,
          bottom: '28%',
          right: '16%',
          transform: 'rotate(20deg)',
          animation: 'dockora-shape-float 11s ease-in-out infinite',
          animationDelay: '-6s',
        }}
      />
    </div>
  );
}
