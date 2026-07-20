"use client";

import { useState } from "react";
import Link from "next/link";
import DitherWave from "@/components/landing/DitherWave";
import MarketChart from "@/components/token/MarketChart";
import JupiterSwap from "@/components/token/JupiterSwap";
import TokenResearchWorkspace from "@/components/token/TokenResearchWorkspace";
import { PROOF_MISSION_MINT } from "@/lib/proof-missions/mission";
import TokenImage from "@/components/ui/TokenImage";
import { useDexMarketData } from "@/hooks/useDexMarketData";
import { useOfficialLaunchMonitor } from "@/hooks/useOfficialLaunchMonitor";
import type { OfficialLaunchEvent } from "@/lib/launchMonitor";

interface Props {
  initialLaunch: OfficialLaunchEvent | null;
  monitorUrl: string | null;
}

function formatTokenAmount(raw: string, decimals: number): string {
  const padded = raw.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals || undefined);
  const fraction = decimals ? padded.slice(-decimals).replace(/0+$/, "") : "";
  return `${BigInt(whole || "0").toLocaleString("en-US")}${fraction ? `.${fraction.slice(0, 4)}` : ""}`;
}

export default function OfficialTokenClient({ initialLaunch, monitorUrl }: Props) {
  const { isLive, launch } = useOfficialLaunchMonitor(initialLaunch, monitorUrl);
  const mintAddress = launch?.mintAddress ?? PROOF_MISSION_MINT;
  const market = useDexMarketData(mintAddress);
  const [isCopied, setIsCopied] = useState(false);
  const symbol = launch?.symbol || "LCKD";

  const copyAddress = async () => {
    if (!mintAddress) return;
    try {
      await navigator.clipboard.writeText(mintAddress);
      setIsCopied(true);
      window.setTimeout(() => setIsCopied(false), 1_500);
    } catch {
      setIsCopied(false);
    }
  };

  const stats = [
    { label: "Price", value: market?.price ?? (mintAddress ? "Indexing" : "Pending") },
    { label: "Market cap", value: market?.marketCap ?? "--" },
    { label: "24h volume", value: market?.volume24h ?? "--" },
    { label: "Liquidity", value: market?.liquidity ?? "--" },
  ];

  return (
    <div className="mx-auto max-w-[1360px] px-4 pb-20 pt-28 sm:px-6 lg:px-10">
      <Link href="/feed" className="mb-5 inline-flex font-mono text-xs text-text-3 transition-colors hover:text-accent-400">
        &larr; back to launch directory
      </Link>

      <header className="relative mb-5 overflow-hidden rounded-card border border-accent/25 bg-[linear-gradient(145deg,rgba(20,25,23,0.98),rgba(10,12,11,0.98))] p-5 sm:p-7 lg:p-9">
        <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
          <DitherWave
            quality="low"
            speed={0.4}
            intensity={0.9}
            scale={6}
            downScale={2}
            opacity={0.28}
            primaryColor="#0B0D0C"
            secondaryColor="#155C3B"
            tertiaryColor="#2BD17E"
            className="pointer-events-none h-full w-full"
          />
        </div>
        <div
          className="pointer-events-none absolute inset-0 z-0"
          aria-hidden="true"
          style={{
            background:
              "linear-gradient(115deg, rgba(10,12,11,0.97) 0%, rgba(10,12,11,0.92) 35%, rgba(10,12,11,0.55) 62%, rgba(10,12,11,0.25) 100%), linear-gradient(0deg, rgba(10,12,11,0.95) 0%, rgba(10,12,11,0.55) 40%, rgba(10,12,11,0.12) 78%, transparent 100%)",
          }}
        />
        <div className="absolute inset-y-0 right-[28%] z-0 hidden w-px bg-gradient-to-b from-transparent via-accent/20 to-transparent lg:block" />
        <div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="flex items-start gap-4">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-[14px] border border-accent/30 bg-accent-dim sm:h-20 sm:w-20 lg:h-24 lg:w-24">
              <TokenImage src="/lckd-token.png" alt="LCKD" size={96} isEager />
            </div>
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-accent/25 bg-accent-dim px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-accent-400">
                  Official token
                </span>
                <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-text-3">
                  <span className={`h-1.5 w-1.5 rounded-full ${isLive ? "animate-pulse bg-accent" : "bg-text-4"}`} />
                  {isLive ? "live monitor" : "monitor standby"}
                </span>
              </div>
              <h1 className="font-sans text-[clamp(30px,7vw,54px)] font-bold leading-none tracking-[-0.04em] text-text-1">
                {launch?.name || "LCKD"}
              </h1>
              <p className="mt-2 font-mono text-sm text-text-3">${symbol} · built for builders who ship</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 font-mono text-[11px]">
            <a href="https://lckd.tech" className="btn-secondary" target="_blank" rel="noopener noreferrer">Website &#8599;</a>
            <a href="https://x.com/launchlckd" className="btn-secondary" target="_blank" rel="noopener noreferrer">X &#8599;</a>
            <a href="https://github.com/rickzsol/lckd" className="btn-secondary" target="_blank" rel="noopener noreferrer">GitHub &#8599;</a>
          </div>
        </div>

        <div className="relative z-10 mt-6 border-t border-line pt-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-text-3">Contract address</span>
            <span className={`font-mono text-[10px] font-semibold uppercase tracking-wider ${launch?.status === "confirmed" ? "text-accent-400" : "text-text-3"}`}>
              {launch?.status === "confirmed" ? "confirmed" : mintAddress ? "detected" : "waiting for launch"}
            </span>
          </div>
          {mintAddress ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <code className="min-w-0 flex-1 break-all rounded-control border border-line-default bg-bg/70 px-3 py-3 font-mono text-xs text-text-1">
                {mintAddress}
              </code>
              <button type="button" onClick={copyAddress} className="btn-primary min-h-11 px-5">
                {isCopied ? "Copied" : "Copy CA"}
              </button>
            </div>
          ) : (
            <div className="rounded-control border border-dashed border-line-default bg-bg/40 px-4 py-4 font-mono text-xs text-text-3">
              The CA will appear here automatically when the monitored launch wallet creates the token.
            </div>
          )}
        </div>
      </header>

      <section className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line-default bg-line-default lg:grid-cols-4" aria-label="Live market data">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-surface px-4 py-4 sm:px-5 lg:px-6 lg:py-5">
            <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-text-3 lg:text-[10px]">{stat.label}</div>
            <div className="mt-1 font-mono text-base font-bold tabular-nums text-text-1 sm:text-lg lg:text-xl">{stat.value}</div>
          </div>
        ))}
      </section>

      <section className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div>
          <MarketChart key={`${mintAddress ?? "pending"}-${market ? "indexed" : "waiting"}`} mintAddress={mintAddress ?? undefined} />
          {mintAddress && !market && (
            <p className="mt-2 font-mono text-[10px] text-text-3">
              The chart is connected. Market indexing can take a short moment after launch.
            </p>
          )}
        </div>
        <div className="flex flex-col gap-4 lg:gap-5">
          <JupiterSwap mintAddress={mintAddress ?? undefined} ticker={symbol} />
          <div className={`rounded-card border p-5 ${launch?.lock ? "border-accent/25 bg-accent-dim" : "border-line-default bg-surface"}`}>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-text-3">Streamflow lock</div>
            {launch?.lock ? (
              <div className="mt-3">
                <div className="font-mono text-xl font-bold tabular-nums text-accent-400">
                  {formatTokenAmount(launch.lock.amountRaw, launch.lock.decimals)} ${symbol}
                </div>
                <div className="mt-2 space-y-1 font-mono text-[10px] leading-relaxed text-text-3">
                  <p>{launch.lock.lockedPercentage?.toFixed(2) ?? "--"}% of the pre-lock dev balance</p>
                  <p>Unlocks {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(launch.lock.unlockAt))} UTC</p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <a href={`https://orbmarkets.io/tx/${launch.lock.signature}`} target="_blank" rel="noopener noreferrer" className="btn-secondary">Lock transaction &#8599;</a>
                  <a href={`https://orbmarkets.io/address/${launch.lock.metadataId}`} target="_blank" rel="noopener noreferrer" className="btn-secondary">Lock contract &#8599;</a>
                </div>
              </div>
            ) : (
              <p className="mt-3 font-mono text-xs leading-relaxed text-text-3">
                Lock amount and unlock time will populate automatically after the manual Streamflow lock is signed.
              </p>
            )}
          </div>
        </div>
      </section>

      <TokenResearchWorkspace mintAddress={mintAddress} ticker={`$${symbol}`} />

      <section className="grid gap-4 md:grid-cols-2 lg:gap-5">
        <div className="rounded-card border border-line-default bg-surface p-5">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-text-3">Official repository</div>
          <a href="https://github.com/rickzsol/lckd" target="_blank" rel="noopener noreferrer" className="mt-2 block break-all font-mono text-sm font-bold text-accent-400 hover:underline">
            github.com/rickzsol/lckd
          </a>
        </div>
        <div className="rounded-card border border-line-default bg-surface p-5">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-text-3">On-chain record</div>
          {mintAddress ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <a href={`https://pump.fun/coin/${mintAddress}`} target="_blank" rel="noopener noreferrer" className="btn-secondary">pump.fun &#8599;</a>
              <a href={`https://orbmarkets.io/token/${mintAddress}`} target="_blank" rel="noopener noreferrer" className="btn-secondary">Orb &#8599;</a>
            </div>
          ) : (
            <p className="mt-2 font-mono text-xs text-text-3">Links activate with the contract address.</p>
          )}
        </div>
      </section>
    </div>
  );
}
