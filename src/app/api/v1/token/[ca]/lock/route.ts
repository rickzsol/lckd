import { type NextRequest } from "next/server";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";
import { hasSupabaseConfig } from "@/lib/supabase";
import { FEATURED_TOKEN } from "@/lib/mock-data";
import type { DisplayToken } from "@/types/display";

export { OPTIONS };

function computeLockStatus(token: DisplayToken) {
  const pct = token.lock.pct;
  let status: "fully_locked" | "locked" | "fully_unlocked";
  if (pct === 0) status = "fully_locked";
  else if (pct >= 100) status = "fully_unlocked";
  else status = "locked";

  const durationMatch = token.lock.duration.match(/^(\d+)/);
  const totalDays = durationMatch ? parseInt(durationMatch[1], 10) : 0;
  const elapsedDays = totalDays > 0 ? Math.round((pct / 100) * totalDays) : 0;
  const daysRemaining = Math.max(0, totalDays - elapsedDays);

  return {
    tokenName: token.name,
    ticker: token.ticker,
    lockAmount: token.lock.amount,
    lockDuration: token.lock.duration,
    percentUnlocked: pct,
    daysRemaining,
    start: token.lock.start,
    end: token.lock.end,
    status,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ ca: string }> },
) {
  try {
    const { ca } = await params;

    if (!ca || ca.trim().length === 0) {
      return apiError("Token address or ID is required", 400);
    }

    let token: DisplayToken | null = null;

    if (hasSupabaseConfig()) {
      try {
        const { getTokenByIdOrMint } = await import("@/lib/queries");
        token = await getTokenByIdOrMint(ca);
      } catch (err) {
        console.error("[token/lock] Supabase error:", err instanceof Error ? err.message : err);
        return apiError("Failed to fetch token lock status", 500);
      }
    }

    if (!token) {
      if (String(FEATURED_TOKEN.id) === ca || FEATURED_TOKEN.mintAddress === ca) {
        token = FEATURED_TOKEN;
      }
    }

    if (!token) return apiError("Token not found", 404);

    return apiResponse({ lock: computeLockStatus(token) });
  } catch (err) {
    console.error("[token/lock] Error:", err instanceof Error ? err.message : err);
    return apiError("Internal server error", 500);
  }
}
