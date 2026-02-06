import { type NextRequest } from "next/server";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";

export { OPTIONS };

const DEXSCREENER_API = "https://api.dexscreener.com/latest/dex/tokens";

interface DexPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd: string;
  volume: { h24: number };
  liquidity: { usd: number };
  fdv: number;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ ca: string }> },
) {
  try {
    const { ca } = await params;

    if (!ca || ca.trim().length === 0) {
      return apiError("Token address is required", 400);
    }

    const response = await fetch(`${DEXSCREENER_API}/${ca}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 },
    });

    if (!response.ok) {
      return apiError(`DexScreener API returned ${response.status}`, 502);
    }

    const data = (await response.json()) as { pairs: DexPair[] | null };

    if (!data.pairs || data.pairs.length === 0) {
      return apiResponse({
        found: false,
        message: "No trading pairs found on DexScreener",
        pairs: [],
      });
    }

    const solanaPairs = data.pairs
      .filter((p) => p.chainId === "solana")
      .map((p) => ({
        dex: p.dexId,
        pairAddress: p.pairAddress,
        baseToken: p.baseToken.symbol,
        quoteToken: p.quoteToken.symbol,
        priceUsd: p.priceUsd,
        volume24h: p.volume.h24,
        liquidityUsd: p.liquidity.usd,
        fdv: p.fdv,
      }));

    return apiResponse({
      found: solanaPairs.length > 0,
      pairs: solanaPairs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "DexScreener lookup failed";
    return apiError(message, 500);
  }
}
