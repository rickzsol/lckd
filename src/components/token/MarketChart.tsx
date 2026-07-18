"use client";

import { useEffect, useRef, useState } from "react";

export default function MarketChart({ mintAddress }: { mintAddress?: string }) {
  const [isReady, setIsReady] = useState(false);
  const readyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (readyTimer.current) clearTimeout(readyTimer.current);
    };
  }, []);

  if (!mintAddress) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-card border border-line-default bg-surface px-6 text-center">
        <div>
          <p className="font-sans text-sm font-semibold text-text-1">Market chart pending</p>
          <p className="mt-1 font-sans text-sm text-text-3">The chart activates when the contract address is recorded.</p>
        </div>
      </div>
    );
  }

  const chartUrl = `https://www.geckoterminal.com/solana/tokens/${encodeURIComponent(mintAddress)}?embed=1&info=0&swaps=0&light_chart=0&chart_type=market_cap&resolution=15m&bg_color=0B0D0C`;

  return (
    <section className="overflow-hidden rounded-card border border-line-default bg-surface" aria-label="Interactive market-cap chart">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-text-2">Market chart</p>
          <p className="mt-0.5 font-mono text-[10px] text-text-3">15 minute candles · market cap · USD</p>
        </div>
        <a
          href={`https://www.geckoterminal.com/solana/tokens/${encodeURIComponent(mintAddress)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[10px] font-semibold text-accent-400 hover:underline"
        >
          full chart &#8599;
        </a>
      </div>
      <div className="relative h-[380px] bg-[#0B0D0C] sm:h-[460px] lg:h-[520px]">
        {!isReady && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0B0D0C]">
            <div className="flex items-center gap-2 font-mono text-[11px] text-text-3" role="status">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
              loading market history
            </div>
          </div>
        )}
        <iframe
          key={mintAddress}
          src={chartUrl}
          title="GeckoTerminal market-cap chart"
          className="h-full w-full border-0"
          loading="eager"
          allowFullScreen
          onLoad={() => {
            if (readyTimer.current) clearTimeout(readyTimer.current);
            readyTimer.current = setTimeout(() => setIsReady(true), 3_000);
          }}
        />
      </div>
    </section>
  );
}
