"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import Badge from "@/components/ui/Badge";
import CommitGraph from "@/components/ui/CommitGraph";
import DexScreenerChart from "@/components/token/DexScreenerChart";
import JupiterSwap from "@/components/token/JupiterSwap";
import type { DisplayToken } from "@/types/display";

function TokenImage({ src, alt }: { src: string; alt: string }) {
  const [hasError, setHasError] = useState(false);
  const isUrl = src.startsWith("http") || src.startsWith("/");

  if (!isUrl || hasError) {
    return (
      <span className="font-mono text-sm font-bold text-accent">
        {hasError ? alt.slice(0, 2).toUpperCase() : src}
      </span>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={96}
      height={96}
      className="h-full w-full object-cover"
      unoptimized
      onError={() => setHasError(true)}
    />
  );
}

export default function TokenDetailClient({ t }: { t: DisplayToken }) {
  return (
    <div className="mx-auto max-w-[1100px] p-4">
      <Link
        href="/feed"
        className="mb-4 inline-block font-mono text-xs text-[#555] transition-colors hover:text-accent"
      >
        &larr; back to feed
      </Link>

      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-accent/20 bg-accent/[0.06]">
            <TokenImage src={t.image} alt={t.name} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-sans text-[clamp(20px,5vw,28px)] font-extrabold text-white">
                {t.name}
              </h1>
              <span className="font-mono text-[13px] text-[#555]">
                {t.ticker}
              </span>
              <Badge tier={t.tier} label={t.tierLabel} />
            </div>
            {t.dev.github && (
              <div className="mt-0.5 font-mono text-[11px] text-[#666]">
                <a
                  href={`https://github.com/${t.dev.github}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  @{t.dev.github}
                </a>
                {t.dev.accountAge && <> &middot; {t.dev.accountAge} on GitHub</>}
                {t.dev.repos !== undefined && <> &middot; {t.dev.repos} repos</>}
              </div>
            )}
          </div>
        </div>
        <div className="mt-2 text-right">
          <div className="font-mono text-[clamp(18px,4vw,24px)] font-bold text-white">
            {t.price}
          </div>
          {t.chg && t.chg !== "+0.0%" && (
            <div
              className="mt-0.5 font-mono text-xs font-semibold"
              style={{
                color: t.chg.startsWith("+") ? "#8b5cf6" : "#ef4444",
              }}
            >
              {t.chg} 24h
            </div>
          )}
        </div>
      </div>

      {/* Primary trading area: Chart + (Repo + Swap) */}
      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
        <DexScreenerChart mintAddress={t.mintAddress} />
        <div className="flex h-full flex-col gap-4">
          {/* Linked Repo — compact */}
          {t.repo && (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
              <div className="mb-2.5 font-mono text-[11px] font-bold uppercase tracking-wider text-[#888]">
                Linked Repository
              </div>
              <a
                href={`https://github.com/${t.dev.github}/${t.repo.name}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg border border-white/[0.06] bg-black/30 px-3 py-2.5 transition-colors hover:border-accent/20"
              >
                <div className="font-mono text-[12px] font-bold text-white">
                  {t.dev.github}/{t.repo.name}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-[#555]">
                  {t.repo.lang} &middot; {t.repo.stars} stars &middot;{" "}
                  {t.repo.forks} forks &middot; {t.repo.commits30d} commits (30d) &middot; pushed {t.repo.lastPush} ago
                </div>
              </a>
            </div>
          )}
          <JupiterSwap mintAddress={t.mintAddress} ticker={t.ticker} />
        </div>
      </div>

      {/* Stats strip */}
      <div className="stats-strip">
        {[
          { l: "MCap", v: t.mcap },
          { l: "24h Vol", v: t.vol },
          { l: "Liquidity", v: t.liquidity ?? "--" },
          { l: "Locked", v: t.lock.amount },
          { l: "Duration", v: t.lock.duration },
        ].map((s) => (
          <div key={s.l} className="bg-[rgba(6,6,15,0.8)] px-2.5 py-3">
            <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-[#444]">
              {s.l}
            </div>
            <div className="font-mono text-[clamp(12px,2.5vw,15px)] font-bold text-white">
              {s.v}
            </div>
          </div>
        ))}
      </div>

      {/* Detail grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Lock card */}
        <div className="rounded-xl border border-accent/15 bg-accent/[0.03] p-5">
          <div className="mb-3.5 flex items-center justify-between font-mono text-[11px] font-bold uppercase tracking-wider text-[#888]">
            <span>Token Lock &mdash; Streamflow</span>
            <span className="text-[10px] font-normal normal-case tracking-normal text-[#555]">
              verify &rarr;
            </span>
          </div>

          <div className="mb-1.5 flex justify-between font-mono text-[11px] text-[#666]">
            <span>{t.lock.start}</span>
            <span>{t.lock.end}</span>
          </div>

          <div className="relative mb-3 h-2 w-full overflow-visible rounded bg-white/[0.04]">
            <div
              className="h-full rounded bg-gradient-to-r from-accent to-emerald-700"
              style={{ width: `${t.lock.pct}%` }}
            />
            <div
              className="absolute -top-[3px] h-3.5 w-0.5 bg-accent shadow-[0_0_8px_rgba(139,92,246,0.5)]"
              style={{ left: `${t.lock.pct}%` }}
            />
          </div>

          <div className="mb-4 text-center">
            <span className="font-mono text-[22px] font-bold text-white">
              {100 - t.lock.pct}%
            </span>
            <span className="ml-1.5 font-mono text-xs text-[#555]">
              still locked
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-black/30 px-3 py-2">
              <div className="font-mono text-[9px] uppercase tracking-wider text-[#555]">
                Tokens
              </div>
              <div className="mt-0.5 font-mono text-sm font-semibold text-[#e5e5e5]">
                {t.lock.amount}
              </div>
            </div>
            <div className="rounded-lg bg-black/30 px-3 py-2">
              <div className="font-mono text-[9px] uppercase tracking-wider text-[#555]">
                Duration
              </div>
              <div className="mt-0.5 font-mono text-sm font-semibold text-[#e5e5e5]">
                {t.lock.duration}
              </div>
            </div>
          </div>
        </div>

        {/* Dev Profile */}
        {t.dev.github && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-5">
            <div className="mb-3.5 font-mono text-[11px] font-bold uppercase tracking-wider text-[#888]">
              Developer Profile
            </div>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-accent/30 bg-accent/10 font-mono text-[13px] font-bold text-accent">
                {t.dev.avatar}
              </div>
              <div>
                <a
                  href={`https://github.com/${t.dev.github}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-sm font-bold text-white hover:text-accent"
                >
                  @{t.dev.github}
                </a>
                <div className="font-mono text-[10px] text-[#555]">
                  {t.dev.repos !== undefined && <>{t.dev.repos} repos &middot; </>}
                  {t.dev.commits !== undefined && (
                    <>{t.dev.commits.toLocaleString()} commits &middot; </>
                  )}
                  {t.dev.accountAge}
                </div>
              </div>
            </div>

            <div className="mb-3">
              <div className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-[#555]">
                commit activity (16 weeks)
              </div>
              <CommitGraph />
            </div>

            {t.dev.lastCommit && (
              <div className="rounded-lg bg-black/30 px-3 py-2.5 font-mono text-xs">
                <span className="text-[#555]">latest &rarr; </span>
                <span className="text-accent">{t.dev.lastCommit}</span>
                {t.dev.lastCommitMsg && (
                  <div className="mt-1 text-[11px] text-[#777]">
                    &ldquo;{t.dev.lastCommitMsg}&rdquo;
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Live URL */}
        {t.live && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="mb-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-accent">
                  Live Product Verified
                </div>
                <a
                  href={
                    t.live.startsWith("http") ? t.live : `https://${t.live}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[13px] text-white hover:text-accent"
                >
                  {t.live}
                </a>
              </div>
              <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_12px_rgba(139,92,246,0.5)]" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
