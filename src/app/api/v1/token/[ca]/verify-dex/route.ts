import { type NextRequest } from "next/server";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";
import { isValidSolanaAddress } from "@/lib/api/validation";
import { checkRateLimit } from "@/lib/api/rateLimit";

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
  request: NextRequest,
  { params }: { params: Promise<{ ca: string }> },
) {
  try {
    const { ca } = await params;

    if (!isValidSolanaAddress(ca)) return apiError("A valid token address is required", 400);

    const limited = await checkRateLimit(request);
    if (limited) return limited;

    const response = await fetch(`${DEXSCREENER_API}/${encodeURIComponent(ca)}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 },
    });

    if (!response.ok) {
      return apiError(`DexScreener API returned ${response.status}`, 502);
    }

    const data = (await response.json()) as { pairs?: DexPair[] | null };

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
        volume24h: p.volume?.h24 ?? 0,
        liquidityUsd: p.liquidity?.usd ?? 0,
        fdv: p.fdv,
      }));

    return apiResponse({
      found: solanaPairs.length > 0,
      pairs: solanaPairs,
    });
  } catch (err) {
    console.error(
      "[verify-dex] Lookup failed:",
      err instanceof Error ? err.message : "Unknown error",
    );
    return apiError("DexScreener lookup failed", 500);
  }
}
