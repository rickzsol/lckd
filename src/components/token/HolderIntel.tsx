"use client";

import { useEffect, useState } from "react";
import type { RicomapsResult } from "@/lib/ricomaps.types";
import RiskChip from "@/components/token/holder-intel/RiskChip";
import StatCells from "@/components/token/holder-intel/StatCells";
import LaunchCohortRow from "@/components/token/holder-intel/LaunchCohortRow";
import TopHoldersTable from "@/components/token/holder-intel/TopHoldersTable";

type LoadState =
  | { phase: "loading" }
  | { phase: "loaded"; result: RicomapsResult }
  | { phase: "failed" };

function SectionShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5 rounded-card border border-line-default bg-surface p-5">
      <div className="mb-3.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-text-2">
        holder intelligence
      </div>
      {children}
    </div>
  );
}

export default function HolderIntel({ mintAddress }: { mintAddress: string }) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      try {
        const response = await fetch(`/api/v1/token/${encodeURIComponent(mintAddress)}/intel`);
        if (!response.ok && response.status !== 503) {
          if (!isCancelled) setState({ phase: "failed" });
          return;
        }
        const body = (await response.json()) as RicomapsResult | { error: string };
        if (isCancelled) return;
        if ("error" in body) {
          setState({ phase: "loaded", result: { status: "unavailable", fetchedAt: new Date().toISOString(), expiresAt: null, data: null } });
          return;
        }
        setState({ phase: "loaded", result: body });
      } catch {
        if (!isCancelled) setState({ phase: "failed" });
      }
    }

    load();
    return () => {
      isCancelled = true;
    };
  }, [mintAddress]);

  if (state.phase === "loading") {
    return (
      <SectionShell>
        <div className="flex items-center gap-2 font-mono text-xs text-text-3">
          <span className="pulse-dot" />
          scan in progress
        </div>
      </SectionShell>
    );
  }

  if (state.phase === "failed" || state.result.status === "unavailable") {
    return (
      <SectionShell>
        <div className="warning-box !block leading-[1.6]">analytics unavailable</div>
      </SectionShell>
    );
  }

  const { result } = state;

  if (result.status === "pending") {
    return (
      <SectionShell>
        <div className="flex items-center gap-2 font-mono text-xs text-text-3">
          <span className="pulse-dot" />
          scan in progress
        </div>
      </SectionShell>
    );
  }

  if (!result.data) {
    return (
      <SectionShell>
        <div className="warning-box !block leading-[1.6]">analytics unavailable</div>
      </SectionShell>
    );
  }

  const summary = result.data;

  return (
    <SectionShell>
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-text-2">
          risk score
        </span>
        <RiskChip summary={summary} />
      </div>

      <StatCells summary={summary} />
      <LaunchCohortRow summary={summary} />
      <TopHoldersTable holders={summary.topHolders} />

      <div className="mt-3 font-mono text-[10px] text-text-4">data: ricomaps</div>
    </SectionShell>
  );
}
