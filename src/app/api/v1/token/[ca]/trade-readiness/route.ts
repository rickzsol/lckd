import type { NextRequest } from "next/server";
import { apiError, apiResponse, OPTIONS } from "@/lib/api/helpers";
import { checkGlobalRateLimit, checkRateLimit } from "@/lib/api/rateLimit";
import { isValidSolanaAddress } from "@/lib/api/validation";
import { loadTradeReadinessEvidence } from "@/lib/trade-readiness/evidence.server";
import { loadTradeReadinessQuotes } from "@/lib/trade-readiness/jupiter.server";

export { OPTIONS };

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ca: string }> },
) {
  const { ca } = await params;
  if (!isValidSolanaAddress(ca)) return apiError("A valid token address is required", 400);

  const view = request.nextUrl.searchParams.get("view") ?? "evidence";
  if (view === "evidence") {
    const limited = await checkRateLimit(request);
    if (limited) return limited;
    const globallyLimited = await checkGlobalRateLimit("tradeEvidenceGlobal");
    if (globallyLimited) return globallyLimited;
    return apiResponse(await loadTradeReadinessEvidence(ca));
  }
  if (view !== "quotes") return apiError("Unknown trade-readiness view", 400);

  const limited = await checkRateLimit(request, "quote");
  if (limited) return limited;
  const globallyLimited = await checkGlobalRateLimit("tradeQuoteGlobal");
  if (globallyLimited) return globallyLimited;
  return apiResponse(await loadTradeReadinessQuotes(ca));
}
