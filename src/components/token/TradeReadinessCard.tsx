"use client";

import { useEffect, useState } from "react";
import type {
  EvidenceStatus,
  TradeReadinessEvidence,
  TradeReadinessQuotes,
} from "@/lib/trade-readiness/types";
import { formatTokenQuote } from "@/lib/trade-readiness/format";

const STATUS_STYLES: Record<EvidenceStatus, string> = {
  caution: "border-warn/35 bg-warn/10 text-warn",
  unknown: "border-line-default bg-surface-deep text-text-3",
  verified: "border-accent/30 bg-accent-dim text-accent-400",
};

const STATUS_LABELS: Record<EvidenceStatus, string> = {
  caution: "review",
  unknown: "unknown",
  verified: "observed",
};

function StatusPill({ status }: { status: EvidenceStatus }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function shorten(value: string): string {
  return `${value.slice(0, 5)}...${value.slice(-5)}`;
}

function formatUsd(value: number | null): string {
  if (value === null) return "Unknown";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatTime(value: string | null): string {
  if (!value) return "time unknown";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

interface EvidenceRowProps {
  detail: string;
  index: string;
  label: string;
  status: EvidenceStatus;
  value: string;
}

function EvidenceRow({ detail, index, label, status, value }: EvidenceRowProps) {
  return (
    <div className="grid gap-3 border-t border-line px-4 py-4 sm:grid-cols-[32px_minmax(0,1fr)_auto] sm:px-5">
      <span className="font-mono text-[10px] text-text-4">{index}</span>
      <div className="min-w-0">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-text-3">{label}</div>
        <div className="mt-1 break-words font-mono text-sm font-bold text-text-1">{value}</div>
        <p className="mt-1 font-sans text-xs leading-relaxed text-text-3">{detail}</p>
      </div>
      <div className="sm:pt-0.5"><StatusPill status={status} /></div>
    </div>
  );
}

function unknownEvidence(mintAddress: string): TradeReadinessEvidence {
  return {
    mintAddress,
    market: { asOf: null, dex: null, liquidityUsd: null, pairAddress: null, pairCreatedAt: null, status: "unknown" },
    onchain: {
      asOf: null,
      authorities: { freezeAuthority: null, mintAuthority: null, status: "unknown" },
      concentration: { accountsRequested: null, ownersAnalyzed: null, status: "unknown", topTenOwnerPercent: null },
      decimals: null,
      extensions: { names: [], flagged: [], status: "unknown" },
      program: "Unknown",
      slot: null,
    },
  };
}

export default function TradeReadinessCard({
  mintAddress,
  ticker,
}: {
  mintAddress?: string | null;
  ticker: string;
}) {
  const [evidence, setEvidence] = useState<TradeReadinessEvidence | null>(null);
  const [quotes, setQuotes] = useState<TradeReadinessQuotes | null>(null);
  const [isQuoteLoading, setIsQuoteLoading] = useState(false);

  useEffect(() => {
    if (!mintAddress) return;
    const controller = new AbortController();
    setEvidence(null);
    setQuotes(null);
    void fetch(`/api/v1/token/${encodeURIComponent(mintAddress)}/trade-readiness?view=evidence`, {
      signal: controller.signal,
    })
      .then(async (response) => response.ok ? response.json() as Promise<TradeReadinessEvidence> : unknownEvidence(mintAddress))
      .then(setEvidence)
      .catch(() => {
        if (!controller.signal.aborted) setEvidence(unknownEvidence(mintAddress));
      });
    return () => controller.abort();
  }, [mintAddress]);

  if (!mintAddress) return null;
  const current = evidence ?? unknownEvidence(mintAddress);
  const authorityValue = current.onchain.authorities.status === "unknown"
    ? "Unknown"
    : current.onchain.authorities.mintAuthority || current.onchain.authorities.freezeAuthority
      ? "Active control found"
      : "Mint and freeze revoked";
  const authorityDetail = current.onchain.authorities.status === "unknown"
    ? "Finalized authority evidence is unavailable."
    : [
    current.onchain.authorities.mintAuthority ? `Mint ${shorten(current.onchain.authorities.mintAuthority)}` : null,
    current.onchain.authorities.freezeAuthority ? `Freeze ${shorten(current.onchain.authorities.freezeAuthority)}` : null,
  ].filter(Boolean).join(" · ") || "Finalized mint account authority fields.";
  const extensionValue = current.onchain.extensions.status === "unknown"
    ? "Unknown"
    : current.onchain.extensions.names.length > 0
      ? `${current.onchain.extensions.names.length} extension${current.onchain.extensions.names.length === 1 ? "" : "s"}`
      : "No extensions";
  const extensionDetail = current.onchain.extensions.status === "unknown"
    ? "Token program control evidence is unavailable."
    : current.onchain.extensions.flagged.length > 0
    ? `Review: ${current.onchain.extensions.flagged.join(", ")}.`
    : `${current.onchain.program} controls parsed from finalized state.`;
  const hasScaledUiAmount = current.onchain.extensions.names.includes("scaledUiAmountConfig");

  const loadQuotes = async () => {
    setIsQuoteLoading(true);
    setQuotes(null);
    try {
      const response = await fetch(
        `/api/v1/token/${encodeURIComponent(mintAddress)}/trade-readiness?view=quotes`,
      );
      if (response.ok) setQuotes(await response.json() as TradeReadinessQuotes);
    } finally {
      setIsQuoteLoading(false);
    }
  };

  return (
    <section className="mb-5 overflow-hidden rounded-card border border-line-default bg-surface" aria-labelledby="trade-readiness-title">
      <div className="flex flex-col gap-4 bg-[linear-gradient(120deg,rgba(43,209,126,0.09),transparent_58%)] px-4 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-5 lg:px-6">
        <div>
          <div className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-accent-400">Read-only preflight / no wallet connected</div>
          <h2 id="trade-readiness-title" className="mt-1 font-sans text-xl font-bold tracking-[-0.02em] text-text-1 sm:text-2xl">Trade readiness</h2>
          <p className="mt-1 max-w-2xl font-sans text-sm leading-relaxed text-text-3">
            Inspect controls, concentration, liquidity, and current routes before opening an execution venue.
          </p>
        </div>
        <div className="font-mono text-[9px] uppercase leading-relaxed tracking-[0.1em] text-text-4 sm:text-right">
          finalized RPC {current.onchain.slot ? `· slot ${current.onchain.slot.toLocaleString()}` : "· unavailable"}<br />
          checked {formatTime(current.onchain.asOf ?? current.market.asOf)} UTC
        </div>
      </div>

      <div className="grid lg:grid-cols-2">
        <div className="lg:border-r lg:border-line">
          <EvidenceRow
            index="01"
            label="Mint controls"
            status={current.onchain.authorities.status}
            value={authorityValue}
            detail={authorityDetail}
          />
          <EvidenceRow
            index="02"
            label="Token program controls"
            status={current.onchain.extensions.status}
            value={extensionValue}
            detail={extensionDetail}
          />
          <EvidenceRow
            index="03"
            label="Largest visible owners"
            status={current.onchain.concentration.status}
            value={current.onchain.concentration.topTenOwnerPercent === null
              ? "Unknown"
              : `At least ${current.onchain.concentration.topTenOwnerPercent.toFixed(2)}% of supply`}
            detail={current.onchain.concentration.status === "unknown"
              ? "Largest-account owner coverage is incomplete, so no concentration estimate is shown."
              : `Lower bound from ${current.onchain.concentration.ownersAnalyzed} owners grouped across ${current.onchain.concentration.accountsRequested} largest token accounts. Review custody and pool addresses separately.`}
          />
          <EvidenceRow
            index="04"
            label="Deepest indexed pair"
            status={current.market.status}
            value={formatUsd(current.market.liquidityUsd)}
            detail={current.market.dex
              ? `${current.market.dex} pair indexed ${formatTime(current.market.asOf)} UTC. Under $25K is marked for review.`
              : "DEX liquidity evidence is unavailable."}
          />
        </div>

        <div className="border-t border-line p-4 sm:p-5 lg:border-t-0 lg:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-text-3">Jupiter quote-only check</div>
              <p className="mt-1 font-sans text-xs leading-relaxed text-text-3">Three exact-input buys plus a reverse route for the 0.1 SOL output.</p>
            </div>
            <button
              type="button"
              onClick={loadQuotes}
              disabled={isQuoteLoading}
              className="btn-primary min-h-10 shrink-0 px-3 text-[10px] disabled:cursor-wait disabled:opacity-60"
            >
              {isQuoteLoading ? "Checking routes" : quotes ? "Refresh routes" : "Check 3 routes"}
            </button>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3" aria-live="polite">
            {[0.1, 0.5, 1].map((amount) => {
              const quote = quotes?.buys.find((item) => item.amountSol === amount);
              const status: EvidenceStatus = !quote || quote.status === "unknown"
                ? "unknown"
                : (quote.impactPercent ?? Infinity) >= 5 ? "caution" : "verified";
              return (
                <div key={amount} data-testid={`buy-preview-${amount}`} className="rounded-control border border-line-default bg-surface-deep p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] font-bold text-text-2">{amount} SOL</span>
                    <StatusPill status={status} />
                  </div>
                  <div className="mt-3 font-mono text-lg font-bold tabular-nums text-text-1">
                    {formatTokenQuote(
                      quote?.estimatedTokenRaw ?? null,
                      hasScaledUiAmount ? null : current.onchain.decimals,
                    )}
                  </div>
                  <div className="mt-1 font-mono text-[9px] leading-relaxed text-text-3">
                    {quote?.status === "available"
                      ? `${ticker} · ${quote.impactPercent?.toFixed(2) ?? "?"}% impact · ${quote.router}${hasScaledUiAmount ? " · scaled UI amount hidden" : ""}`
                      : "Route not checked or unavailable"}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 rounded-control border border-line-default bg-surface-deep p-3.5">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">Reverse route check</span>
              <StatusPill status={!quotes?.reverse ? "unknown" : quotes.reverse.isAvailable ? "verified" : "caution"} />
            </div>
            <div className="mt-2 font-mono text-sm font-bold tabular-nums text-text-1">
              {quotes?.reverse?.isAvailable && quotes.reverse.estimatedSol !== null
                ? `${quotes.reverse.estimatedSol.toFixed(4)} SOL estimated back`
                : "Unknown"}
            </div>
            <p className="mt-1 font-sans text-xs leading-relaxed text-text-3">
              {quotes?.reverse?.retainedPercent !== null && quotes?.reverse?.retainedPercent !== undefined
                ? `${quotes.reverse.retainedPercent.toFixed(1)}% of the starting 0.1 SOL before wallet fees. A route is not a guarantee of execution.`
                : "No sellability conclusion is shown until a current reverse route is returned."}
            </p>
          </div>

          <p className="mt-4 font-mono text-[9px] leading-relaxed text-text-4">
            Observations are not a safety score or trade recommendation. Sources: finalized Solana RPC via Helius, DexScreener, and Jupiter Swap API V2.
          </p>
        </div>
      </div>
    </section>
  );
}
