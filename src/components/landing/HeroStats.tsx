"use client";

import { useEffect, useState } from "react";
import CountUp from "@/components/ui/CountUp";
import { useOfficialLaunchMonitor } from "@/hooks/useOfficialLaunchMonitor";
import type { OfficialLaunchEvent } from "@/lib/launchMonitor";

interface StatsResponse {
  launched: number;
  totalLocked: number;
  devsVerified: number;
  buildingNow: number;
  available: boolean;
}

const FALLBACK: StatsResponse = {
  launched: 0,
  totalLocked: 0,
  devsVerified: 0,
  buildingNow: 0,
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

interface Props {
  initialLaunch: OfficialLaunchEvent | null;
  monitorUrl: string | null;
}

function mergeOfficialStats(
  stats: StatsResponse,
  launch: OfficialLaunchEvent | null,
): StatsResponse {
  if (!launch || launch.status === "retracted") return stats;
  const hasActiveLock = Boolean(launch.lock && launch.lock.status !== "retracted");
  const lockedTokens = hasActiveLock && launch.lock
    ? Number(launch.lock.amountRaw) / (10 ** launch.lock.decimals)
    : 0;
  return {
    launched: Math.max(stats.launched, 1),
    totalLocked: Math.max(stats.totalLocked, lockedTokens),
    devsVerified: Math.max(stats.devsVerified, 1),
    buildingNow: hasActiveLock ? stats.buildingNow : Math.max(stats.buildingNow, 1),
    available: true,
  };
}

export default function HeroStats({ initialLaunch, monitorUrl }: Props) {
  const [stats, setStats] = useState<StatsResponse>(FALLBACK);
  const { launch } = useOfficialLaunchMonitor(initialLaunch, monitorUrl);

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

  const displayStats = mergeOfficialStats(stats, launch);

  return (
    <div className="grid w-[min(100%,560px)] grid-cols-[repeat(auto-fit,minmax(118px,1fr))] gap-[clamp(14px,3vw,24px)]">
      <div className="text-center">
        <div className={VALUE_CLASS}>
          <CountUp to={displayStats.launched} duration={1.4} />
        </div>
        <div className={LABEL_CLASS}>launched</div>
      </div>
      <div className="text-center">
        <div className={`${VALUE_CLASS} text-accent-400`}>
          <CountUp to={compactParts(displayStats.totalLocked).value} duration={1.4} />
          {compactParts(displayStats.totalLocked).suffix}
        </div>
        <div className={LABEL_CLASS}>total locked</div>
      </div>
      <div className="text-center">
        <div className={VALUE_CLASS}>
          <CountUp to={displayStats.devsVerified} duration={1.4} />
        </div>
        <div className={LABEL_CLASS}>devs verified</div>
      </div>
      <div className="text-center">
        <div className="inline-flex items-center gap-[7px] font-mono text-[22px] font-bold tabular-nums text-text-1">
          <span className="pulse-dot h-[5px] w-[5px] rounded-full bg-accent shadow-[0_0_8px_rgba(43,209,126,0.6)]" />
          <CountUp to={displayStats.buildingNow} duration={1.4} />
        </div>
        <div className={LABEL_CLASS}>building now</div>
      </div>
    </div>
  );
}
