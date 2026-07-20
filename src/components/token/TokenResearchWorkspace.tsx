import type { ReactNode } from "react";
import { PROOF_MISSION_MINT } from "@/lib/proof-missions/mission";
import ProofMissionCard from "./ProofMissionCard";
import TradeReadinessCard from "./TradeReadinessCard";

export default function TokenResearchWorkspace({
  mintAddress,
  ticker,
}: {
  mintAddress?: string | null;
  ticker: string;
}) {
  if (!mintAddress) return null;
  const hasProofMission = mintAddress === PROOF_MISSION_MINT;

  return (
    <section
      className="relative mb-5 overflow-hidden rounded-[22px] border border-line-default bg-[linear-gradient(145deg,rgba(16,20,18,0.96),rgba(9,11,10,0.98))]"
      aria-labelledby="research-workspace-title"
      data-testid="token-research-workspace"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent" aria-hidden="true" />
      <header className="grid gap-5 border-b border-line px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:px-8 lg:py-8">
        <div className="max-w-3xl">
          <div className="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-accent-400">
            Research workspace / independent checks
          </div>
          <h2 id="research-workspace-title" className="mt-2 font-sans text-2xl font-bold tracking-[-0.03em] text-text-1 sm:text-3xl">
            Read the market. Verify the evidence.
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-3">
            A read-only layer for checking token controls, current routes, and community-sourced research before leaving LCKD.
          </p>
        </div>
        <ol className="flex flex-wrap gap-2 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-text-3" aria-label="Research workspace sections">
          <li className="rounded-full border border-accent/25 bg-accent-dim px-3 py-1.5"><span className="mr-2 text-accent-400">01</span>Preflight</li>
          {hasProofMission && <li className="rounded-full border border-line-default bg-surface px-3 py-1.5"><span className="mr-2 text-accent-400">02</span>Community proof</li>}
        </ol>
      </header>

      <div className="space-y-4 p-3 sm:p-4 lg:p-5">
        <ResearchLayer index="01" label="Token preflight">
          <TradeReadinessCard mintAddress={mintAddress} ticker={ticker} />
        </ResearchLayer>
        {hasProofMission && (
          <ResearchLayer index="02" label="Community verification">
            <ProofMissionCard mintAddress={mintAddress} />
          </ResearchLayer>
        )}
      </div>
    </section>
  );
}

function ResearchLayer({
  children,
  index,
  label,
}: {
  children: ReactNode;
  index: string;
  label: string;
}) {
  return (
    <div className="grid gap-2 lg:grid-cols-[76px_minmax(0,1fr)] lg:gap-3">
      <div className="flex items-center gap-2 px-1 font-mono uppercase lg:flex-col lg:items-start lg:px-2 lg:pt-5">
        <span className="text-[11px] font-bold text-accent-400">{index}</span>
        <span className="text-[8px] font-semibold tracking-[0.14em] text-text-4 lg:max-w-14 lg:leading-4">{label}</span>
      </div>
      {children}
    </div>
  );
}
