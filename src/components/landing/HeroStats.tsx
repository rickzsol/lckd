"use client";

import { useEffect, useState } from "react";
import CountUp from "@/components/ui/CountUp";

interface StatsResponse {
  launched: number;
  totalLocked: number;
  devsVerified: number;
  buildingNow: number;
  available: boolean;
}

const FALLBACK: StatsResponse = {
  launched: 128,
  totalLocked: 4_200_000,
  devsVerified: 96,
  buildingNow: 31,
  available: true,
};

function compactParts(n: number): { value: number; suffix: string } {
  if (n >= 1_000_000_000) return { value: Number((n / 1_000_000_000).toFixed(1)), suffix: "B" };
  if (n >= 1_000_000) return { value: Number((n / 1_000_000).toFixed(1)), suffix: "M" };
  if (n >= 1_000) return { value: Number((n / 1_000).toFixed(1)), suffix: "K" };
  return { value: n, suffix: "" };
}

const LABEL_CLASS =
  "mt-[3px] font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3";
const VALUE_CLASS = "font-mono text-[22px] font-bold tabular-nums text-text-1";

export default function HeroStats() {
  const [stats, setStats] = useState<StatsResponse>(FALLBACK);

  useEffect(() => {
    fetch("/api/v1/stats")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: StatsResponse | null) => {
        if (data && data.available) setStats(data);
      })
      .catch(() => {
        /* keep fallback values */
      });
  }, []);

  return (
    <div className="grid w-[min(100%,560px)] grid-cols-[repeat(auto-fit,minmax(118px,1fr))] gap-[clamp(14px,3vw,24px)]">
      <div className="text-center">
        <div className={VALUE_CLASS}>
          <CountUp to={stats.launched} duration={1.4} />
        </div>
        <div className={LABEL_CLASS}>launched</div>
      </div>
      <div className="text-center">
        <div className={`${VALUE_CLASS} text-accent-400`}>
          {"$"}
          <CountUp to={compactParts(stats.totalLocked).value} duration={1.4} />
          {compactParts(stats.totalLocked).suffix}
        </div>
        <div className={LABEL_CLASS}>total locked</div>
      </div>
      <div className="text-center">
        <div className={VALUE_CLASS}>
          <CountUp to={stats.devsVerified} duration={1.4} />
        </div>
        <div className={LABEL_CLASS}>devs verified</div>
      </div>
      <div className="text-center">
        <div className="inline-flex items-center gap-[7px] font-mono text-[22px] font-bold tabular-nums text-text-1">
          <span className="pulse-dot h-[5px] w-[5px] rounded-full bg-accent shadow-[0_0_8px_rgba(43,209,126,0.6)]" />
          <CountUp to={stats.buildingNow} duration={1.4} />
        </div>
        <div className={LABEL_CLASS}>building now</div>
      </div>
    </div>
  );
}
