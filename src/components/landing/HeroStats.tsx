"use client";

import { useEffect, useState } from "react";
import CountUp from "@/components/ui/CountUp";

interface StatsResponse {
  launched: number | null;
  totalLockedTokens: number | null;
  devsVerified: number | null;
  buildingNow: number | null;
  asOf: string | null;
  available: boolean;
}

const FALLBACK: StatsResponse = {
  launched: null,
  totalLockedTokens: null,
  devsVerified: null,
  buildingNow: null,
  asOf: null,
  available: false,
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

function StatValue({ value }: { value: number | null }) {
  if (value === null) return <span className="text-text-4">--</span>;
  return <CountUp to={value} duration={1.4} />;
}

function CompactStatValue({ value }: { value: number | null }) {
  if (value === null) return <span className="text-text-4">--</span>;
  const compact = compactParts(value);
  return (
    <>
      <CountUp to={compact.value} duration={1.4} />
      {compact.suffix}
    </>
  );
}

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
          <StatValue value={stats.launched} />
        </div>
        <div className={LABEL_CLASS}>launched</div>
      </div>
      <div className="text-center">
        <div className={`${VALUE_CLASS} text-accent-400`}>
          <CompactStatValue value={stats.totalLockedTokens} />
        </div>
        <div className={LABEL_CLASS}>total locked</div>
      </div>
      <div className="text-center">
        <div className={VALUE_CLASS}>
          <StatValue value={stats.devsVerified} />
        </div>
        <div className={LABEL_CLASS}>devs verified</div>
      </div>
      <div className="text-center">
        <div className="inline-flex items-center gap-[7px] font-mono text-[22px] font-bold tabular-nums text-text-1">
          <span className="pulse-dot h-[5px] w-[5px] rounded-full bg-accent shadow-[0_0_8px_rgba(43,209,126,0.6)]" />
          <StatValue value={stats.buildingNow} />
        </div>
        <div className={LABEL_CLASS}>building now</div>
      </div>
    </div>
  );
}
