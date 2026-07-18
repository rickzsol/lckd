"use client";

import Link from "next/link";
import Image from "next/image";
import Badge from "@/components/ui/Badge";
import TokenImage from "@/components/ui/TokenImage";
import DexScreenerChart from "@/components/token/DexScreenerChart";
import JupiterSwap from "@/components/token/JupiterSwap";
import ContributionGraph from "@/components/github/ContributionGraph";
import type { DisplayToken } from "@/types/display";

export default function TokenDetailClient({ t }: { t: DisplayToken }) {
  const hasLockRecord =
    t.lock.amount !== "--" &&
    t.lock.amount !== "0" &&
    t.lock.duration !== "--";

  return (
    <div className="mx-auto max-w-[1360px] px-4 pt-28 pb-16 sm:px-6 lg:px-10">
      <Link
        href="/feed"
        className="mb-4 inline-block font-mono text-xs text-text-3 transition-colors duration-180 ease-out hover:text-accent-400"
      >
        &larr; back to feed
      </Link>

      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-accent/25 bg-accent-dim">
            <TokenImage src={t.image} alt={t.name} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-sans text-[clamp(20px,5vw,28px)] font-bold tracking-[-0.01em] text-text-1">
                {t.name}
              </h1>
              <span className="font-mono text-[13px] text-text-3">
                {t.ticker}
              </span>
              <Badge tier={t.tier} label={`${t.tierLabel} PROFILE`} />
            </div>
            {t.dev.github && (
              <div className="mt-0.5 font-mono text-[11px] text-text-3">
                <a
                  href={`https://github.com/${t.dev.github}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-400 hover:underline"
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
          <div className="font-mono text-[clamp(18px,4vw,24px)] font-bold text-text-1 tabular-nums">
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

      <div className="warning-box mb-5 !block leading-[1.6]">
        This page combines platform records and third-party market data. Profile labels are
        not audits. Verify the mint and any lock contract independently.
      </div>

      {/* Primary area: (Chart + Stats) left, (Repo + Swap + Lock + Dev) sidebar */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex min-w-0 flex-col gap-4 lg:gap-5">
          <DexScreenerChart mintAddress={t.mintAddress} />
          <div className="stats-strip">
            {[
              { l: "MCap", v: t.mcap, isLocked: false },
              { l: "24h Vol", v: t.vol, isLocked: false },
              { l: "Liquidity", v: t.liquidity ?? "--", isLocked: false },
              { l: "Recorded Lock", v: hasLockRecord ? t.lock.amount : "Unverified", isLocked: hasLockRecord },
              { l: "Recorded Duration", v: hasLockRecord ? t.lock.duration : "Unverified", isLocked: hasLockRecord },
            ].map((s) => (
              <div key={s.l}>
                <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">
                  {s.l}
                </div>
                <div
                  className={`font-mono text-[clamp(12px,2.5vw,15px)] font-bold tabular-nums ${
                    s.isLocked ? "text-accent-400" : "text-text-1"
                  }`}
                >
                  {s.v}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-4 lg:gap-5">
          {/* Linked Repo, compact */}
          {t.repo && (
            <div className="rounded-card border border-line-default bg-surface p-4">
              <div className="mb-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-text-2">
              Submitted repository
              </div>
              <a
                href={`https://github.com/${t.dev.github}/${t.repo.name}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-control border border-line-default bg-surface-deep px-3 py-2.5 transition-colors duration-180 ease-out hover:border-accent/35"
              >
                <div className="font-mono text-xs font-bold text-text-1">
                  {t.dev.github}/{t.repo.name}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-text-3 tabular-nums">
                  {t.repo.lang} &middot; {t.repo.stars} stars &middot;{" "}
                  {t.repo.forks} forks &middot; {t.repo.commits30d} commits (30d) &middot; pushed {t.repo.lastPush} ago
                </div>
              </a>
            </div>
          )}
          <JupiterSwap mintAddress={t.mintAddress} ticker={t.ticker} />

          {/* Lock card */}
        <div className={`rounded-card border p-5 ${hasLockRecord ? "border-accent/20 bg-accent-dim" : "border-warn/25 bg-[rgba(224,167,62,0.04)]"}`}>
          <div className="mb-3.5 flex items-center justify-between font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-text-2">
            <span>Token lock record</span>
          </div>

          {hasLockRecord ? (
            <>
              <div className="mb-1.5 flex justify-between font-mono text-[11px] text-text-3 tabular-nums">
                <span>{t.lock.start}</span>
                <span>{t.lock.end}</span>
              </div>
              <div
                className="relative mb-3 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]"
                role="progressbar"
                aria-label="Estimated lock schedule elapsed"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={t.lock.pct}
              >
                <div
                  className={`h-full rounded-full ${
                    t.lock.pct < 30 ? "bg-accent" : t.lock.pct < 60 ? "bg-warn" : "bg-danger"
                  }`}
                  style={{ width: `${t.lock.pct}%` }}
                />
              </div>
              <p className="mb-4 font-mono text-xs leading-[1.6] text-text-3">
                Platform estimate: {100 - t.lock.pct}% remains on the recorded schedule. Confirm
                the live contract before relying on this value.
              </p>
              <div className="mb-4 grid grid-cols-2 gap-2">
                <div className="rounded-control bg-surface-deep px-3 py-2">
                  <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">Recorded tokens</div>
                  <div className="mt-0.5 font-mono text-sm font-semibold text-text-1 tabular-nums">{t.lock.amount}</div>
                </div>
                <div className="rounded-control bg-surface-deep px-3 py-2">
                  <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">Recorded duration</div>
                  <div className="mt-0.5 font-mono text-sm font-semibold text-text-1 tabular-nums">{t.lock.duration}</div>
                </div>
              </div>
              {t.mintAddress && (
                <div className="callout-success !inline-flex">
                  &#10003; lock verified on-chain &middot; streamflow #{t.mintAddress.slice(0, 4)}&hellip;{t.mintAddress.slice(-4)}
                </div>
              )}
            </>
          ) : (
            <div role="status" className="warning-box !block leading-[1.6]">
              <p className="font-mono text-sm font-bold">Lock verification unavailable</p>
              <p className="mt-2 font-sans text-sm leading-[1.6] text-text-2">
                This record does not contain enough lock data to show a schedule. Do not assume
                any tokens are locked.
              </p>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <a href="https://app.streamflow.finance/token-lock" target="_blank" rel="noopener noreferrer" className="btn-secondary">
              Streamflow explorer <span aria-hidden="true">&#8599;</span>
            </a>
            {t.mintAddress && (
              <a href={`https://solscan.io/token/${t.mintAddress}`} target="_blank" rel="noopener noreferrer" className="btn-secondary">
                Mint on Solscan <span aria-hidden="true">&#8599;</span>
              </a>
            )}
          </div>
        </div>

          {/* Dev profile + product link */}
          {t.dev.github && (
            <div className="rounded-card border border-line-default bg-surface p-5">
              <div className="mb-3.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-text-2">
                Developer Profile
              </div>
              <div className="flex items-center gap-3">
                <Image
                  src={`https://github.com/${t.dev.github}.png?size=80`}
                  alt=""
                  width={40}
                  height={40}
                  unoptimized
                  className="h-10 w-10 shrink-0 rounded-full border border-accent/30 bg-accent-dim object-cover"
                />
                <div>
                  <a
                    href={`https://github.com/${t.dev.github}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-sm font-bold text-text-1 hover:text-accent-400"
                  >
                    @{t.dev.github}
                  </a>
                  <div className="font-mono text-[10px] text-text-3 tabular-nums">
                    {t.dev.repos !== undefined && <>{t.dev.repos} repos &middot; </>}
                    {t.dev.commits !== undefined && (
                      <>{t.dev.commits.toLocaleString()} commits &middot; </>
                    )}
                    {t.dev.accountAge}
                  </div>
                </div>
              </div>

              <ContributionGraph username={t.dev.github} />

              <p className="mt-4 border-t border-line pt-3.5 font-mono text-[11px] leading-[1.6] text-text-3">
                GitHub handle submitted with this launch. Review the public account and repository
                history directly on GitHub.
              </p>
            </div>
          )}

          {t.live && (
            <div className="rounded-card border border-line-default bg-surface p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="mb-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-accent-400">
                    Submitted product link
                  </div>
                  <a
                    href={
                      t.live.startsWith("http") ? t.live : `https://${t.live}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[13px] text-text-1 hover:text-accent-400"
                  >
                    {t.live}
                  </a>
                </div>
                <span className="pulse-dot" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
