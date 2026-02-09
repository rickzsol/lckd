"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import Badge from "@/components/ui/Badge";
import Bar from "@/components/ui/Bar";
import type { DisplayToken, DisplayCommit } from "@/types/display";

function FeedImage({ src, alt }: { src: string; alt: string }) {
  const [hasError, setHasError] = useState(false);
  const isUrl = src.startsWith("http") || src.startsWith("/");

  if (!isUrl || hasError) {
    return (
      <span className="font-mono text-xs font-bold text-emerald-accent">
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

type Filter = "all" | "builders" | "shipped";

export default function FeedClient({
  tokens,
  commits,
}: {
  tokens: DisplayToken[];
  commits: DisplayCommit[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [commitIdx, setCommitIdx] = useState(0);

  useEffect(() => {
    if (commits.length === 0) return;
    const iv = setInterval(
      () => setCommitIdx((i) => (i + 1) % commits.length),
      3000,
    );
    return () => clearInterval(iv);
  }, [commits.length]);

  const list = tokens.filter((t) =>
    filter === "builders"
      ? t.tier >= 3
      : filter === "shipped"
        ? t.tier >= 4
        : true,
  );

  const c = commits[commitIdx];

  return (
    <div className="mx-auto max-w-[1100px] p-4">
      {/* Live ticker */}
      {c && (
        <div className="mb-3.5 flex items-center gap-2 overflow-hidden rounded-lg border border-emerald-accent/10 bg-emerald-accent/[0.04] px-3 py-2 font-mono text-[11px]">
          <span className="pulse-dot" />
          <span className="shrink-0 text-emerald-accent">@{c.dev}</span>
          <span className="shrink-0 text-[#444]">&rarr;</span>
          <span className="shrink-0 font-semibold text-white">{c.ticker}</span>
          <span className="min-w-0 flex-1 truncate text-[#555]">{c.msg}</span>
          <span className="shrink-0 text-[#444]">{c.time}</span>
        </div>
      )}

      {/* Header + filters */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-sans text-xl font-bold text-white">
          Active Builders
        </h2>
        <div className="flex gap-1">
          {(["all", "builders", "shipped"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-[5px] border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide transition-all ${
                filter === f
                  ? "border-emerald-accent/30 bg-emerald-accent/[0.08] text-emerald-accent"
                  : "border-white/[0.06] bg-transparent text-[#555]"
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
          <div className="font-mono text-[48px] text-white/10">
            {"{ }"}
          </div>
          {tokens.length === 0 ? (
            <>
              <p className="mt-3 font-mono text-sm text-[#555]">
                No tokens launched yet.
              </p>
              <Link
                href="/launch"
                className="btn-primary mt-4 px-5 py-2.5"
              >
                be the first to launch &rarr;
              </Link>
            </>
          ) : (
            <>
              <p className="mt-3 font-mono text-sm text-[#555]">
                No tokens found for this filter.
              </p>
              <button
                onClick={() => setFilter("all")}
                className="mt-2 font-mono text-xs text-emerald-accent underline underline-offset-2"
              >
                show all tokens
              </button>
            </>
          )}
        </div>
      )}

      {/* Token list */}
      <div className="flex flex-col gap-2">
        {list.map((t) => {
          const href = t.mintAddress
            ? `/token/${t.mintAddress}`
            : `/token/${t.id}`;

          return (
            <Link key={t.id} href={href} className="token-card block">
              {/* Row 1 */}
              <div className="mb-2 flex items-center gap-2.5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-emerald-accent/20 bg-emerald-accent/[0.06]">
                  <FeedImage src={t.image} alt={t.name} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-[5px]">
                    <span className="font-sans text-sm font-bold text-white">
                      {t.name}
                    </span>
                    <span className="font-mono text-[11px] text-[#555]">
                      {t.ticker}
                    </span>
                    <Badge tier={t.tier} label={t.tierLabel} />
                  </div>
                  <div className="truncate font-mono text-[10px] text-[#444]">
                    {t.dev.github
                      ? `@${t.dev.github}${t.dev.accountAge ? ` · ${t.dev.accountAge}` : ""}`
                      : "anon dev"}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-[13px] font-bold text-[#e5e5e5]">
                    {t.mcap}
                  </div>
                  {t.chg && t.chg !== "+0.0%" && (
                    <div
                      className="font-mono text-[11px] font-semibold"
                      style={{
                        color: t.chg.startsWith("+") ? "#10b981" : "#ef4444",
                      }}
                    >
                      {t.chg}
                    </div>
                  )}
                </div>
              </div>

              {/* Row 2 */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center font-mono text-[10px] text-[#888]">
                  <span className="mr-1.5">
                    LOCKED {t.lock.amount} · {t.lock.duration}
                  </span>
                  <div className="min-w-[40px] flex-1">
                    <Bar pct={t.lock.pct} />
                  </div>
                  <span className="ml-1.5 text-[#555]">
                    {100 - t.lock.pct}%
                  </span>
                </div>
                {t.repo && (
                  <div className="font-mono text-[10px] text-[#444]">
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
