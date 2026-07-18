export interface DexMarketData {
  price: string;
  mcap: string;
  volume: string;
  change24h: string;
  holders: number;
  liquidity: string;
}

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.0001) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(8)}`;
}

function formatChange(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

// DexScreener sits behind Cloudflare, which closes idle keepalive sockets;
// a reused connection then fails with "other side closed" on the first try.
async function fetchDexScreener(url: string): Promise<Response> {
  try {
    return await fetch(url, { next: { revalidate: 60 } });
  } catch {
    return fetch(url, { next: { revalidate: 60 } });
  }
}

export async function fetchMarketData(
  mintAddress: string,
): Promise<DexMarketData | null> {
  try {
    const res = await fetchDexScreener(
      `https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`,
    );
    if (!res.ok) return null;

    const json = await res.json();
    const pairs = json.pairs;
    if (!pairs || pairs.length === 0) return null;

    // Use the pair with highest liquidity
    const pair = pairs.reduce(
      (best: (typeof pairs)[0], p: (typeof pairs)[0]) =>
        (p.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0) ? p : best,
      pairs[0],
    );

    return {
      price: formatUsd(parseFloat(pair.priceUsd ?? "0")),
      mcap: pair.marketCap ? formatUsd(pair.marketCap) : "--",
      volume: pair.volume?.h24 ? formatUsd(pair.volume.h24) : "--",
      change24h: pair.priceChange?.h24 != null
        ? formatChange(pair.priceChange.h24)
        : "+0.0%",
      holders: 0, // DexScreener doesn't provide holder count
      liquidity: pair.liquidity?.usd ? formatUsd(pair.liquidity.usd) : "--",
    };
  } catch {
    return null;
  }
}

export async function fetchMarketDataBatch(
  mintAddresses: string[],
): Promise<Map<string, DexMarketData>> {
  const result = new Map<string, DexMarketData>();
  if (mintAddresses.length === 0) return result;

  // DexScreener supports up to 30 addresses comma-separated
  const chunks: string[][] = [];
  for (let i = 0; i < mintAddresses.length; i += 30) {
    chunks.push(mintAddresses.slice(i, i + 30));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const res = await fetchDexScreener(
          `https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`,
        );
        if (!res.ok) return;

        const json = await res.json();
        const pairs = json.pairs;
        if (!pairs || pairs.length === 0) return;

        // Group pairs by base token address, keep highest liquidity
        const bestByMint = new Map<string, (typeof pairs)[0]>();
        for (const p of pairs) {
          const addr = p.baseToken?.address;
          if (!addr) continue;
          const existing = bestByMint.get(addr);
          if (
            !existing ||
            (p.liquidity?.usd ?? 0) > (existing.liquidity?.usd ?? 0)
          ) {
            bestByMint.set(addr, p);
          }
        }

        for (const [addr, pair] of bestByMint) {
          result.set(addr, {
            price: formatUsd(parseFloat(pair.priceUsd ?? "0")),
            mcap: pair.marketCap ? formatUsd(pair.marketCap) : "--",
            volume: pair.volume?.h24 ? formatUsd(pair.volume.h24) : "--",
            change24h: pair.priceChange?.h24 != null
              ? formatChange(pair.priceChange.h24)
              : "+0.0%",
            holders: 0,
            liquidity: pair.liquidity?.usd
              ? formatUsd(pair.liquidity.usd)
              : "--",
          });
        }
      } catch {
        // Silently skip failed chunks
      }
    }),
  );

  return result;
}
