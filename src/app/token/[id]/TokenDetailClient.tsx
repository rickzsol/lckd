"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import ContributionGraph from "@/components/github/ContributionGraph";
import MarketChart from "@/components/token/MarketChart";
import JupiterSwap from "@/components/token/JupiterSwap";
import TokenLockCard from "@/components/token/TokenLockCard";
import TokenMetadataCard from "@/components/token/TokenMetadataCard";
import AllocationPanel from "@/components/token/AllocationPanel";
import Badge, { getTrustBadgeLabel } from "@/components/ui/Badge";
import TokenImage from "@/components/ui/TokenImage";
import type { AllocationPageData } from "@/lib/allocations/loadSummary";
import type { DisplayToken } from "@/types/display";

function shortenAddress(address: string): string {
  return `${address.slice(0, 7)}…${address.slice(-7)}`;
}

export default function TokenDetailClient({
  t,
  allocations = null,
}: {
  t: DisplayToken;
  allocations?: AllocationPageData | null;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const hasLockRecord =
    t.lock.amount !== "--" &&
    t.lock.amount !== "0" &&
    t.lock.duration !== "--";

  const copyAddress = async () => {
    if (!t.mintAddress) return;
    try {
      await navigator.clipboard.writeText(t.mintAddress);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1_500);
    } catch {
      setCopyState("failed");
      window.setTimeout(() => setCopyState("idle"), 2_500);
    }
  };

  return (
    <div className="mx-auto max-w-[1360px] px-4 pb-16 pt-28 sm:px-6 lg:px-10 2xl:max-w-[1480px]">
      <Link
        href="/feed"
        className="mb-4 inline-block font-mono text-xs text-text-3 transition-colors hover:text-accent-400"
      >
        &larr; back to feed
      </Link>

      <header className="mb-5 rounded-card border border-line-default bg-surface p-4 sm:p-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-[14px] border border-accent/25 bg-accent-dim">
              <TokenImage src={t.image} alt={t.name} size={72} isEager />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-sans text-[clamp(24px,5vw,34px)] font-bold leading-none tracking-[-0.02em] text-text-1">
                  {t.name}
                </h1>
                <span className="font-mono text-[13px] text-text-3">{t.ticker}</span>
                <Badge tier={t.tier} label={getTrustBadgeLabel(t.tierLabel)} />
              </div>
              {t.dev.github && (
                <a
                  href={`https://github.com/${t.dev.github}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block font-mono text-[11px] text-accent-400 hover:underline"
                >
                  @{t.dev.github}
                </a>
              )}
            </div>
          </div>

          <div className="sm:text-right">
            <div className="font-mono text-[clamp(20px,4vw,28px)] font-bold text-text-1 tabular-nums">
              {t.price}
            </div>
            {t.chg && t.chg !== "+0.0%" && (
              <div
                className={`mt-0.5 font-mono text-xs font-semibold tabular-nums ${
                  t.chg.startsWith("+") ? "text-accent-400" : "text-danger"
                }`}
              >
                {t.chg} 24h
              </div>
            )}
          </div>
        </div>

        {t.metadata.description && (
          <p className="mt-4 max-w-3xl font-sans text-[15px] leading-[1.65] text-text-2">
            {t.metadata.description}
          </p>
        )}

        {t.mintAddress && (
          <button
            type="button"
            onClick={copyAddress}
            className="focus-ring mt-4 flex min-h-12 w-full items-center gap-3 rounded-control border border-line-default bg-surface-deep px-3 text-left transition-colors hover:border-accent/40 sm:w-auto sm:max-w-full"
            aria-label={`Copy contract address ${t.mintAddress}`}
          >
            <span className="shrink-0 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-text-3">
              CA
            </span>
            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-1 sm:hidden">
              {shortenAddress(t.mintAddress)}
            </code>
            <code className="hidden min-w-0 flex-1 break-all font-mono text-[11px] text-text-1 sm:block">
              {t.mintAddress}
            </code>
            <span
              className="shrink-0 font-mono text-[10px] font-semibold text-accent-400"
              role="status"
              aria-live="polite"
            >
              {copyState === "copied" ? "copied" : copyState === "failed" ? "retry" : "copy"}
            </span>
          </button>
        )}
      </header>

      <div className="mb-5 rounded-control border border-line-default bg-surface px-4 py-3 font-sans text-sm leading-[1.6] text-text-3">
        LCKD verifies the recorded launch and lock receipts. Market data is provided by external venues.
      </div>

      <section className="stats-strip mb-5" aria-label="Token market and lock data">
        {[
          { label: "Market cap", value: t.mcap, isLocked: false },
          { label: "24h volume", value: t.vol, isLocked: false },
          { label: "Liquidity", value: t.liquidity ?? "--", isLocked: false },
          {
            label: "Recorded lock",
            value: hasLockRecord ? t.lock.amount : "Unverified",
            isLocked: hasLockRecord,
          },
          {
            label: "Lock duration",
            value: hasLockRecord ? t.lock.duration : "Unverified",
            isLocked: hasLockRecord,
          },
        ].map((stat) => (
          <div key={stat.label}>
            <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">
              {stat.label}
            </div>
            <div
              className={`font-mono text-[clamp(12px,2.5vw,15px)] font-bold tabular-nums ${
                stat.isLocked ? "text-accent-400" : "text-text-1"
              }`}
            >
              {stat.value}
            </div>
          </div>
        ))}
      </section>

      <section className="mb-5 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
        <MarketChart mintAddress={t.mintAddress} />
        <div className="flex flex-col gap-4 lg:gap-5">
          <TokenLockCard token={t} />
          <JupiterSwap mintAddress={t.mintAddress} ticker={t.ticker} />
        </div>
      </section>

      {allocations && t.mintAddress && (
        <AllocationPanel
          summary={allocations.summary}
          creatorWallet={allocations.creatorWallet}
          lockedAmountRaw={allocations.lockedAmountRaw}
          mintAddress={t.mintAddress}
        />
      )}

      <section className="grid min-w-0 items-start gap-4 lg:grid-cols-2 lg:gap-5">
        <TokenMetadataCard token={t} />
        {t.dev.github && <DeveloperCard token={t} />}
        {t.repo && <RepositoryCard token={t} />}
      </section>
    </div>
  );
}

function DeveloperCard({ token }: { token: DisplayToken }) {
  const github = token.dev.github;
  if (!github) return null;
  const developerStats = [
    token.dev.repos !== undefined ? `${token.dev.repos} repos` : null,
    token.dev.commits !== undefined ? `${token.dev.commits.toLocaleString()} commits` : null,
    token.dev.accountAge,
  ].filter((value): value is string => Boolean(value));

  return (
    <section className="min-w-0 rounded-card border border-line-default bg-surface p-5">
      <div className="mb-3.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-text-2">
        Developer profile
      </div>
      <div className="flex items-center gap-3">
        <Image
          src={`https://avatars.githubusercontent.com/${github}?size=80`}
          alt=""
          width={40}
          height={40}
          sizes="40px"
          quality={60}
          className="h-10 w-10 shrink-0 rounded-full border border-accent/30 bg-accent-dim object-cover"
        />
        <div>
          <a
            href={`https://github.com/${github}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-sm font-bold text-text-1 hover:text-accent-400"
          >
            @{github}
          </a>
          {developerStats.length > 0 && (
            <div className="mt-0.5 font-mono text-[10px] text-text-3 tabular-nums">
              {developerStats.join(" · ")}
            </div>
          )}
        </div>
      </div>
      <ContributionGraph username={github} />
      <p className="mt-4 border-t border-line pt-3.5 font-mono text-[11px] leading-[1.6] text-text-3">
        Review the submitted account and repository history directly on GitHub.
      </p>
    </section>
  );
}

function RepositoryCard({ token }: { token: DisplayToken }) {
  if (!token.repo || !token.dev.github) return null;
  return (
    <a
      href={`https://github.com/${token.dev.github}/${token.repo.name}`}
      target="_blank"
      rel="noopener noreferrer"
      className="block min-w-0 rounded-card border border-line-default bg-surface p-5 transition-colors hover:border-accent/35"
    >
      <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-text-2">
        Submitted repository
      </div>
      <div className="mt-3 font-mono text-sm font-bold text-text-1">
        {token.dev.github}/{token.repo.name}
      </div>
      <div className="mt-1 font-mono text-[10px] leading-[1.6] text-text-3 tabular-nums">
        {token.repo.lang} · {token.repo.stars} stars · {token.repo.forks} forks · {token.repo.commits30d} commits in 30d · pushed {token.repo.lastPush} ago
      </div>
    </a>
  );
}
