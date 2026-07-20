"use client";

import { useState } from "react";
import Link from "next/link";
import Badge, { getTrustBadgeLabel } from "@/components/ui/Badge";
import TokenImage from "@/components/ui/TokenImage";
import Bar from "@/components/ui/Bar";
import { useOfficialLaunchMonitor } from "@/hooks/useOfficialLaunchMonitor";
import type { DisplayToken } from "@/types/display";


type Filter = "all" | "builders" | "shipped";

interface Props {
  launchMonitorUrl: string | null;
  officialMintAddress: string;
  tokens: DisplayToken[];
}

function lockProgress(lockedAt: string, unlockAt: string): number {
  const startMs = new Date(lockedAt).getTime();
  const endMs = new Date(unlockAt).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  return Math.floor(Math.min(1, Math.max(0, (Date.now() - startMs) / (endMs - startMs))) * 100);
}

function formatLockAmount(raw: string, decimals: number): string {
  const amount = Number(raw) / 10 ** decimals;
  if (!Number.isFinite(amount)) return "--";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amount);
}

function formatUnlockDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value));
}

export default function FeedClient({ launchMonitorUrl, officialMintAddress, tokens }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const { launch: officialLaunch } = useOfficialLaunchMonitor(null, launchMonitorUrl);

  const list = tokens.filter((t) =>
    filter === "builders"
      ? t.tier >= 3
      : filter === "shipped"
        ? t.tier >= 4
        : true,
  ).sort((left, right) =>
    Number(right.mintAddress === officialMintAddress) -
    Number(left.mintAddress === officialMintAddress),
  );

  return (
    <div className="mx-auto max-w-[1152px] px-4 pt-28 pb-16 sm:px-6">
      <div className="mb-6">
        <h1 className="font-sans text-[clamp(28px,6vw,40px)] font-bold tracking-[-0.02em] text-text-1">
          Launch directory
        </h1>
        <p className="mt-2 max-w-2xl font-sans text-[15px] leading-[1.6] text-text-2">
          LCKD verifies recorded launch and lock receipts. Review linked GitHub and on-chain records independently.
        </p>
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-y border-line py-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-text-3">Filter builder activity</p>
        <div className="flex flex-wrap gap-1.5" aria-label="Filter launch records">
          {(["all", "builders", "shipped"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={`min-h-9 rounded-full border px-3.5 font-mono text-[11px] font-semibold uppercase tracking-wide transition-colors duration-180 ease-out ${
                filter === f
                  ? "border-accent bg-accent-dim text-accent-400"
                  : "border-line-default bg-surface-2 text-text-3"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Empty state */}
      {list.length === 0 && (
        <div className="flex flex-col items-center py-16">
          <div className="font-mono text-[48px] text-text-4">
            {"{ }"}
          </div>
          {tokens.length === 0 ? (
            <>
              <p className="mt-3 font-mono text-sm text-text-3">
                No launch records are available.
              </p>
              <Link href="/launch" className="btn-primary mt-4 inline-flex">
                launch token
              </Link>
            </>
          ) : (
            <>
              <p className="mt-3 font-mono text-sm text-text-3">
                No tokens found for this filter.
              </p>
              <button
                type="button"
                onClick={() => setFilter("all")}
                className="mt-2 min-h-11 rounded-control px-3 font-mono text-xs text-accent-400 underline underline-offset-2"
              >
                show all tokens
              </button>
            </>
          )}
        </div>
      )}

      {/* Token list */}
      <div className="flex flex-col gap-2.5">
        {list.map((t, index) => {
          const href = t.mintAddress
            ? `/token/${t.mintAddress}`
            : `/token/${t.id}`;
          const isOfficial = t.mintAddress === officialMintAddress;
          const liveOfficialLock = isOfficial &&
            officialLaunch?.mintAddress === officialMintAddress &&
            officialLaunch.status === "confirmed" &&
            officialLaunch.lock?.status === "confirmed"
            ? officialLaunch.lock
            : null;
          const hasLockRecord = Boolean(liveOfficialLock) ||
            t.lock.amount !== "--" &&
            t.lock.amount !== "0" &&
            t.lock.duration !== "--";
          const displayedLockAmount = liveOfficialLock
            ? `${formatLockAmount(liveOfficialLock.amountRaw, liveOfficialLock.decimals)} ${officialLaunch?.symbol ?? "LCKD"}`
            : `${t.lock.amount} · ${t.lock.duration}`;
          const displayedLockPct = liveOfficialLock
            ? lockProgress(liveOfficialLock.detectedAt, liveOfficialLock.unlockAt)
            : t.lock.pct;
          const displayedUnlockDate = liveOfficialLock
            ? formatUnlockDate(liveOfficialLock.unlockAt)
            : t.lock.end;

          return (
            <Link
              key={t.id}
              href={href}
              className={`token-card block ${isOfficial ? "!border-accent/35 !bg-accent-dim" : ""}`}
            >
              {isOfficial && (
                <div className="mb-3 flex items-center justify-between gap-3 border-b border-accent/20 pb-2.5">
                  <span className="inline-flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-accent-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
                    Official launch
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-3">
                    LCKD protocol token
                  </span>
                </div>
              )}

              <div className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3">
                <div className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded-[10px] border bg-surface-2 ${isOfficial ? "border-accent/30" : "border-line-default"}`}>
                  <TokenImage
                    src={t.image}
                    alt={t.name}
                    size={48}
                    quality={60}
                    isEager={index < 4}
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="font-sans text-[15px] font-bold text-text-1">
                      {t.name}
                    </span>
                    <span className="truncate font-mono text-[11px] text-text-3">
                      {t.ticker}
                    </span>
                  </div>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="max-w-full truncate font-mono text-[10px] text-text-3">
                      {t.dev.github
                        ? `@${t.dev.github}${t.dev.accountAge ? ` · ${t.dev.accountAge}` : ""}`
                        : t.dev.provider === "twitter" && t.dev.username
                          ? `@${t.dev.username} on X`
                          : "anon dev"}
                    </span>
                    <Badge tier={t.tier} label={getTrustBadgeLabel(t.tierLabel)} />
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-[8px] font-semibold uppercase tracking-[0.12em] text-text-4">
                    Market cap
                  </div>
                  <div className="font-mono text-sm font-bold text-text-1 tabular-nums">
                    {t.mcap}
                  </div>
                  {t.chg && t.chg !== "+0.0%" && (
                    <div
                      className={`font-mono text-[11px] font-semibold tabular-nums ${
                        t.chg.startsWith("+") ? "text-accent-400" : "text-danger"
                      }`}
                    >
                      {t.chg}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 border-t border-line pt-3">
                <div className="flex items-center justify-between gap-3 font-mono text-[10px]">
                  <span className="font-semibold uppercase tracking-[0.12em] text-text-4">Lock receipt</span>
                  <span className="text-right font-semibold text-text-2 tabular-nums">
                    {hasLockRecord ? displayedLockAmount : t.metadata.hasLock ? "Unavailable" : "No lock"}
                  </span>
                </div>
                {hasLockRecord && (
                  <>
                    <div className="mt-2">
                      <Bar pct={displayedLockPct} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 font-mono text-[9px] text-text-3 tabular-nums">
                      {liveOfficialLock?.lockedPercentage !== null && liveOfficialLock?.lockedPercentage !== undefined && (
                        <span>{liveOfficialLock.lockedPercentage.toFixed(2)}% of dev balance locked</span>
                      )}
                      <span>
                        {displayedLockPct >= 100
                          ? `Lock term complete · unlocked ${displayedUnlockDate}`
                          : `${displayedLockPct}% of lock term elapsed · unlocks ${displayedUnlockDate}`}
                      </span>
                    </div>
                  </>
                )}
                {t.repo && (
                  <div className="mt-2 font-mono text-[9px] text-text-3 tabular-nums">
                    {t.repo.stars} stars · {t.repo.commits30d} commits/30d ·
                    pushed {t.repo.lastPush} ago
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
