"use client";

import { useState } from "react";
import { useOfficialLaunchMonitor } from "@/hooks/useOfficialLaunchMonitor";
import type { OfficialLaunchEvent } from "@/lib/launchMonitor";

interface Props {
  initialLaunch: OfficialLaunchEvent | null;
  monitorUrl: string | null;
}

function formatTokenAmount(raw: string, decimals: number): string {
  const padded = raw.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals || undefined);
  const fraction = decimals > 0 ? padded.slice(-decimals).replace(/0+$/, "") : "";
  const grouped = BigInt(whole || "0").toLocaleString("en-US");
  return fraction ? `${grouped}.${fraction.slice(0, 4)}` : grouped;
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 12)}…${address.slice(-12)}`;
}

export default function OfficialLaunchMonitor({ initialLaunch, monitorUrl }: Props) {
  const { isLive, launch } = useOfficialLaunchMonitor(initialLaunch, monitorUrl);
  const [isCopied, setIsCopied] = useState(false);

  const copyAddress = async () => {
    if (!launch) return;
    try {
      await navigator.clipboard.writeText(launch.mintAddress);
      setIsCopied(true);
      window.setTimeout(() => setIsCopied(false), 1_500);
    } catch {
      setIsCopied(false);
    }
  };

  return (
    <section className="mb-5 overflow-hidden rounded-card border border-accent/30 bg-[linear-gradient(135deg,rgba(43,209,126,0.09),rgba(15,18,17,0.95)_52%)]" aria-live="polite">
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-400">
              Official token launch
            </div>
            <h2 className="mt-1 font-sans text-lg font-bold text-text-1">
              {launch ? `${launch.name} (${launch.symbol})` : "Waiting for the contract address"}
            </h2>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-line-default bg-bg/60 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-text-2">
            <span className={`h-1.5 w-1.5 rounded-full ${isLive ? "animate-pulse bg-accent" : "bg-text-4"}`} />
            {launch?.status === "confirmed" ? "confirmed" : launch ? "detected" : isLive ? "watching" : "standby"}
          </div>
        </div>

        {launch ? (
          <div>
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-text-3">
              Contract address (CA)
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <code title={launch.mintAddress} className="min-w-0 flex-1 truncate rounded-control border border-line-default bg-bg/70 px-3 py-2.5 font-mono text-[12px] text-text-1">
                <span aria-hidden="true">{shortenAddress(launch.mintAddress)}</span>
                <span className="sr-only">{launch.mintAddress}</span>
              </code>
              <button type="button" onClick={copyAddress} className="btn-secondary min-h-11 shrink-0 px-4">
                {isCopied ? "Copied" : "Copy CA"}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10px] text-text-3">
              <span>
                {launch.status === "confirmed"
                  ? "Helius confirmed the Pump creation from the launch wallet."
                  : "Detected on-chain. Confirmation is pending."}
              </span>
              <a href={`https://pump.fun/coin/${launch.mintAddress}`} target="_blank" rel="noopener noreferrer" className="text-accent-400 underline underline-offset-2">
                pump.fun
              </a>
              <a href={`https://orbmarkets.io/token/${launch.mintAddress}`} target="_blank" rel="noopener noreferrer" className="text-accent-400 underline underline-offset-2">
                Orb
              </a>
            </div>
            <div className="mt-4 border-t border-line pt-4">
              {launch.lock ? (
                <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-text-3">
                      Manual Streamflow lock
                    </div>
                    <div className="mt-1 font-mono text-base font-bold text-accent-400 tabular-nums">
                      {formatTokenAmount(launch.lock.amountRaw, launch.lock.decimals)} {launch.symbol}
                    </div>
                    <div className="mt-1 font-mono text-[10px] leading-relaxed text-text-3">
                      {launch.lock.lockedPercentage !== null
                        ? `${launch.lock.lockedPercentage.toFixed(2)}% of the dev wallet balance · `
                        : ""}
                      unlocks {new Intl.DateTimeFormat("en-US", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: "UTC",
                      }).format(new Date(launch.lock.unlockAt))} UTC
                    </div>
                    <a
                      href={`https://orbmarkets.io/address/${launch.lock.metadataId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={launch.lock.metadataId}
                      className="mt-1 block truncate font-mono text-[10px] text-accent-400 underline underline-offset-2"
                    >
                      Lock contract {shortenAddress(launch.lock.metadataId)}
                    </a>
                  </div>
                  <a
                    href={`https://orbmarkets.io/tx/${launch.lock.signature}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary min-h-10 px-3 py-2 text-center text-[10px]"
                  >
                    {launch.lock.status === "confirmed" ? "View lock transaction" : "Lock detected"}
                  </a>
                </div>
              ) : (
                <p className="font-mono text-[10px] text-text-3">
                  Waiting for the manual Streamflow lock. Amount and unlock time will update here.
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="max-w-2xl font-mono text-[11px] leading-relaxed text-text-3">
            This field updates as soon as the monitored dev wallet creates the token on Pump. The address is checked against the signed creation transaction before it appears here.
          </p>
        )}
      </div>
    </section>
  );
}
