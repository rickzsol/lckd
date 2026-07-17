"use client";

import { useState } from "react";
import type { RicomapsSummary } from "@/lib/ricomaps.types";

export default function LaunchCohortRow({ summary }: { summary: RicomapsSummary }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { launchCohort, coordinatedEntry } = summary;

  return (
    <div className="mt-3 rounded-control border border-line-default">
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left"
        aria-expanded={isExpanded}
      >
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-text-2">
          launch cohort
        </span>
        <span className="flex items-center gap-2">
          {coordinatedEntry && (
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-danger">
              coordinated entry
            </span>
          )}
          <span className="font-mono text-xs text-text-3">{isExpanded ? "−" : "+"}</span>
        </span>
      </button>
      {isExpanded && (
        <div className="border-t border-line-default px-3 py-2.5 font-mono text-xs leading-[1.6] text-text-3">
          {launchCohort.walletCount === 0 ? (
            <p>no coordinated wallets detected in the launch window.</p>
          ) : (
            <p>
              <span className="tabular-nums text-text-1">{launchCohort.walletCount}</span> wallets
              acquired{" "}
              <span className="tabular-nums text-text-1">{launchCohort.supplyPct.toFixed(1)}%</span>{" "}
              of supply within{" "}
              <span className="tabular-nums text-text-1">{launchCohort.windowSeconds}s</span> of launch.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
