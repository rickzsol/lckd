"use client";

import { useState } from "react";
import Link from "next/link";
import Badge from "@/components/ui/Badge";
import TokenImage from "@/components/ui/TokenImage";
import Bar from "@/components/ui/Bar";
import OfficialLaunchMonitor from "@/components/feed/OfficialLaunchMonitor";
import type { OfficialLaunchEvent } from "@/lib/launchMonitor";
import type { DisplayToken } from "@/types/display";


type Filter = "all" | "builders" | "shipped";

interface Props {
  launchMonitorUrl: string | null;
  officialLaunch: OfficialLaunchEvent | null;
  tokens: DisplayToken[];
}

export default function FeedClient({ launchMonitorUrl, officialLaunch, tokens }: Props) {
  const [filter, setFilter] = useState<Filter>("all");

  const list = tokens.filter((t) =>
    filter === "builders"
      ? t.tier >= 3
      : filter === "shipped"
        ? t.tier >= 4
        : true,
  );

  return (
    <div className="mx-auto max-w-[1152px] px-4 pt-28 pb-16 sm:px-6">
      <div className="mb-6">
        <h1 className="font-sans text-[clamp(28px,6vw,40px)] font-bold tracking-[-0.02em] text-text-1">
          Launch directory
        </h1>
        <p className="mt-2 max-w-2xl font-sans text-[15px] leading-[1.6] text-text-2">
          Platform records can be incomplete or stale. Profile labels are not audits. Verify
          mint addresses, market data, and lock contracts before relying on them.
        </p>
      </div>

      <OfficialLaunchMonitor
        initialLaunch={officialLaunch}
        monitorUrl={launchMonitorUrl}
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-y border-line py-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-text-3">Filter profile labels</p>
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
      {list.length === 0 && !officialLaunch && (
        <div className="flex flex-col items-center py-16">
          <div className="font-mono text-[48px] text-text-4">
            {"{ }"}
          </div>
          {tokens.length === 0 ? (
            <>
              <p className="mt-3 font-mono text-sm text-text-3">
                No launch records are available.
              </p>
              <Link
                href="/launch"
                className="btn-primary mt-4"
              >
                open launch wizard &rarr;
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
        {list.map((t) => {
          const href = t.mintAddress
            ? `/token/${t.mintAddress}`
            : `/token/${t.id}`;
          const hasLockRecord =
            t.lock.amount !== "--" &&
            t.lock.amount !== "0" &&
            t.lock.duration !== "--";

          return (
            <Link key={t.id} href={href} className="token-card block">
              {/* Row 1 */}
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-accent/25 bg-accent-dim">
                  <TokenImage src={t.image} alt={t.name} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-sans text-[15px] font-bold text-text-1">
                      {t.name}
                    </span>
                    <span className="font-mono text-xs text-text-3">
                      {t.ticker}
                    </span>
                    <Badge tier={t.tier} label={`${t.tierLabel} PROFILE`} />
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-text-3">
                    {t.dev.github
                      ? `@${t.dev.github}${t.dev.accountAge ? ` · ${t.dev.accountAge}` : ""}`
                      : "anon dev"}
                  </div>
                </div>
                <div className="shrink-0 text-right">
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

              {/* Row 2 */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2.5 font-mono text-[11px] text-text-2">
                  <span className="whitespace-nowrap">
                    {hasLockRecord
                      ? `LOCKED ${t.lock.amount} · ${t.lock.duration}`
                      : "Lock verification unavailable"}
                  </span>
                  {hasLockRecord && (
                    <>
                      <div className="min-w-[40px] flex-1">
                        <Bar pct={t.lock.pct} />
                      </div>
                      <span className="whitespace-nowrap text-text-3 tabular-nums">
                        {100 - t.lock.pct}% locked
                      </span>
                    </>
                  )}
                </div>
                {t.repo && (
                  <div className="font-mono text-[10px] text-text-3 tabular-nums">
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
