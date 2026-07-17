"use client";

import { useEffect, useRef, useState } from "react";
import type { RicomapsResult } from "@/lib/ricomaps.client";
import RiskChip from "@/components/token/holder-intel/RiskChip";
import StatCells from "@/components/token/holder-intel/StatCells";
import LaunchCohortRow from "@/components/token/holder-intel/LaunchCohortRow";
import TopHoldersTable from "@/components/token/holder-intel/TopHoldersTable";

type LoadState =
  | { phase: "loading" }
  | { phase: "loaded"; result: RicomapsResult }
  | { phase: "failed" };

const POLL_DELAYS_MS = [5_000, 10_000, 20_000];
const POLL_TIMEOUT_MS = 120_000;

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

function ScanInProgress() {
  return (
    <div className="flex items-center gap-2 font-mono text-xs text-text-3">
      <span className="pulse-dot" />
      scan in progress
    </div>
  );
}

function formatScannedAt(scannedAt: string | null): string | null {
  if (!scannedAt) return null;
  const parsed = new Date(scannedAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export default function HolderIntel({ mintAddress }: { mintAddress: string }) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const pollAttemptRef = useRef(0);
  const pollStartedAtRef = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    pollAttemptRef.current = 0;
    pollStartedAtRef.current = null;

    async function load() {
      try {
        const response = await fetch(`/api/v1/token/${encodeURIComponent(mintAddress)}/intel`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          if (!controller.signal.aborted) setState({ phase: "failed" });
          return;
        }
        const result = (await response.json()) as RicomapsResult;
        if (controller.signal.aborted) return;

        setState({ phase: "loaded", result });

        if (result.status !== "pending") return;

        if (pollStartedAtRef.current === null) pollStartedAtRef.current = Date.now();
        const elapsed = Date.now() - pollStartedAtRef.current;
        if (elapsed >= POLL_TIMEOUT_MS) return;

        const delay = POLL_DELAYS_MS[Math.min(pollAttemptRef.current, POLL_DELAYS_MS.length - 1)];
        pollAttemptRef.current += 1;
        timeoutId = setTimeout(load, delay);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ phase: "failed" });
      }
    }

    load();
    return () => {
      controller.abort();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [mintAddress]);

  if (state.phase === "loading") {
    return (
      <SectionShell>
        <ScanInProgress />
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

  if (result.status === "pending" || !result.data) {
    return (
      <SectionShell>
        <ScanInProgress />
      </SectionShell>
    );
  }

  const summary = result.data;
  const scannedAtLabel = formatScannedAt(result.scannedAt);

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

      {result.status === "stale" && (
        <div className="mt-3 font-mono text-[10px] text-text-3">
          stale data{scannedAtLabel ? `, last scanned ${scannedAtLabel}` : ""}
        </div>
      )}
      <div className="mt-3 font-mono text-[10px] text-text-4">data: ricomaps</div>
    </SectionShell>
  );
}
