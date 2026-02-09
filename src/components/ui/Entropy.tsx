"use client";

import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  vx: number;
  vy: number;
  size: number;
  isOrdered: boolean;
}

export default function Entropy({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let particles: Particle[] = [];
    let w = 0;
    let h = 0;
    let rafId: number;

    function init() {
      const rect = canvas!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      const area = w * h;
      const count = Math.min(250, Math.max(60, Math.floor(area / 5000)));
      const cols = Math.ceil(Math.sqrt(count * (w / h)));
      const rows = Math.ceil(count / cols);
      const sx = w / cols;
      const sy = h / rows;
      const mid = w * 0.5;

      particles = [];
      for (let i = 0; i < count; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const hx = sx * (col + 0.5);
        const hy = sy * (row + 0.5);

        particles.push({
          x: hx + (Math.random() - 0.5) * sx,
          y: hy + (Math.random() - 0.5) * sy,
          homeX: hx,
          homeY: hy,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          size: Math.random() * 1.5 + 0.5,
          isOrdered: hx < mid,
        });
      }
    }

    function frame() {
      ctx!.clearRect(0, 0, w, h);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        if (p.isOrdered) {
          // Spring back toward grid position
          p.vx += (p.homeX - p.x) * 0.008;
          p.vy += (p.homeY - p.y) * 0.008;
          p.vx *= 0.96;
          p.vy *= 0.96;

          // Chaotic particles pull nearby ordered ones
          for (let j = 0; j < particles.length; j++) {
            const o = particles[j];
            if (o.isOrdered) continue;
            const dx = o.x - p.x;
            const dy = o.y - p.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < 3600 && d2 > 1) {
              const dist = Math.sqrt(d2);
              const force = ((60 - dist) / 60) * 0.15;
              p.vx += (dx / dist) * force;
              p.vy += (dy / dist) * force;
            }
          }
        } else {
          // Chaotic: random drift
          p.vx += (Math.random() - 0.5) * 0.1;
          p.vy += (Math.random() - 0.5) * 0.1;
          p.vx *= 0.985;
          p.vy *= 0.985;

          // Soft bounds
          if (p.x < 5) p.vx += 0.2;
          else if (p.x > w - 5) p.vx -= 0.2;
          if (p.y < 5) p.vy += 0.2;
          else if (p.y > h - 5) p.vy -= 0.2;
        }

        p.x += p.vx;
        p.y += p.vy;

        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx!.fillStyle = p.isOrdered
          ? "rgba(16, 185, 129, 0.45)"
          : "rgba(16, 185, 129, 0.18)";
        ctx!.fill();
      }

      rafId = requestAnimationFrame(frame);
    }

    const ro = new ResizeObserver(init);
    ro.observe(canvas);
    init();
    rafId = requestAnimationFrame(frame);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ pointerEvents: "none" }}
      aria-hidden="true"
    />
  );
}
