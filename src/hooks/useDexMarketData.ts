"use client";

import { useEffect, useState } from "react";

interface DexPair {
  chainId: string;
  fdv?: number;
  liquidity?: { usd?: number };
  marketCap?: number;
  priceChange?: { h24?: number };
  priceUsd?: string;
  volume?: { h24?: number };
}

export interface LiveMarketData {
  change24h: string;
  liquidity: string;
  marketCap: string;
  price: string;
  volume24h: string;
}

function formatUsd(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "--";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(value >= 0.0001 ? 6 : 10)}`;
}

export function parseDexMarketPairs(value: unknown): LiveMarketData | null {
  if (!Array.isArray(value)) return null;
  const pairs = value.filter((pair): pair is DexPair =>
    Boolean(pair && typeof pair === "object" && Reflect.get(pair, "chainId") === "solana"),
  );
  if (pairs.length === 0) return null;
  const pair = pairs.reduce((best, candidate) =>
    (candidate.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0) ? candidate : best,
  );
  const change = pair.priceChange?.h24;
  return {
    change24h: Number.isFinite(change)
      ? `${Number(change) >= 0 ? "+" : ""}${Number(change).toFixed(2)}%`
      : "--",
    liquidity: formatUsd(pair.liquidity?.usd),
    marketCap: formatUsd(pair.marketCap ?? pair.fdv),
    price: formatUsd(Number(pair.priceUsd)),
    volume24h: formatUsd(pair.volume?.h24),
  };
}

export function useDexMarketData(mintAddress: string | null) {
  const [result, setResult] = useState<{
    market: LiveMarketData;
    mintAddress: string;
  } | null>(null);

  useEffect(() => {
    if (!mintAddress) return;
    let isActive = true;
    const refresh = async () => {
      try {
        const response = await fetch(
          `https://api.dexscreener.com/tokens/v1/solana/${encodeURIComponent(mintAddress)}`,
          { cache: "no-store", signal: AbortSignal.timeout(8_000) },
        );
        if (!response.ok || !isActive) return;
        const nextMarket = parseDexMarketPairs(await response.json());
        if (isActive && nextMarket) setResult({ market: nextMarket, mintAddress });
      } catch {
        return;
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 15_000);
    return () => {
      isActive = false;
      window.clearInterval(interval);
    };
  }, [mintAddress]);

  return result?.mintAddress === mintAddress ? result.market : null;
}
