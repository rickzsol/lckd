"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface StatItem {
  label: string;
  value: string;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

const CHARS = "0123456789$.,KMB%+";
const CYCLE_DURATION = 800;
const CHAR_RESOLVE_INTERVAL = 60;
const STAGGER_DELAY = 150;
const CYCLE_SPEED = 40;

function useScramble(target: string, delay: number) {
  const [display, setDisplay] = useState(target);
  const frameRef = useRef<number>(0);

  const animate = useCallback(() => {
    const len = target.length;
    let resolvedCount = 0;
    let elapsed = 0;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = now - lastTime;
      lastTime = now;
      elapsed += dt;

      if (elapsed < delay) {
        frameRef.current = requestAnimationFrame(tick);
        return;
      }

      const activeElapsed = elapsed - delay;
      resolvedCount = Math.min(
        len,
        Math.floor(activeElapsed / CHAR_RESOLVE_INTERVAL),
      );

      const chars: string[] = [];
      for (let i = 0; i < len; i++) {
        if (i < resolvedCount) {
          chars.push(target[i]);
        } else if (target[i] === " ") {
          chars.push(" ");
        } else {
          chars.push(CHARS[Math.floor(Math.random() * CHARS.length)]);
        }
      }

      setDisplay(chars.join(""));

      if (resolvedCount < len) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };

    // Start cycling immediately (before delay, show random chars)
    const preCycle = (now: number) => {
      const dt = now - lastTime;
      lastTime = now;
      elapsed += dt;

      if (elapsed >= delay) {
        frameRef.current = requestAnimationFrame(tick);
        return;
      }

      // During pre-delay, cycle through random chars
      if (Math.floor(elapsed / CYCLE_SPEED) !== Math.floor((elapsed - dt) / CYCLE_SPEED)) {
        const chars: string[] = [];
        for (let i = 0; i < len; i++) {
          if (target[i] === " ") {
            chars.push(" ");
          } else {
            chars.push(CHARS[Math.floor(Math.random() * CHARS.length)]);
          }
        }
        setDisplay(chars.join(""));
      }

      frameRef.current = requestAnimationFrame(preCycle);
    };

    frameRef.current = requestAnimationFrame(preCycle);
  }, [target, delay]);

  useEffect(() => {
    animate();
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [animate]);

  return display;
}

function StatCell({ label, value, delay }: { label: string; value: string; delay: number }) {
  const display = useScramble(value, delay);

  return (
    <div className="text-center">
      <div className="font-mono text-[clamp(16px,4vw,22px)] font-bold text-white tabular-nums">
        {display}
      </div>
      <div className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-[#555]">
        {label}
      </div>
    </div>
  );
}

export default function StatsBoard() {
  const [stats, setStats] = useState<StatItem[]>([
    { label: "launched", value: "--" },
    { label: "total locked", value: "--" },
    { label: "devs verified", value: "--" },
    { label: "building now", value: "--" },
  ]);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    fetch("/api/v1/stats")
      .then((r) => r.json())
      .then((data) => {
        setStats([
          { label: "launched", value: data.launched.toString() },
          { label: "total locked", value: formatNumber(data.totalLocked) },
          { label: "devs verified", value: data.devsVerified.toString() },
          { label: "building now", value: data.buildingNow.toString() },
        ]);
        setIsReady(true);
      })
      .catch(() => setIsReady(true));
  }, []);

  if (!isReady) {
    return (
      <div className="grid w-full grid-cols-2 gap-1.5 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="text-center">
            <div className="font-mono text-[clamp(16px,4vw,22px)] font-bold text-white">
              --
            </div>
            <div className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-[#555]">
              {stat.label}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid w-full grid-cols-2 gap-1.5 sm:grid-cols-4">
      {stats.map((stat, i) => (
        <StatCell
          key={stat.label}
          label={stat.label}
          value={stat.value}
          delay={i * STAGGER_DELAY}
        />
      ))}
    </div>
  );
}
