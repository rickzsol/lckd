import { type NextRequest } from "next/server";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";
import { isValidSolanaAddress, isValidTokenIdentifier } from "@/lib/api/validation";
import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";

export { OPTIONS };

const DAY_MS = 86_400_000;

function formatTokenAmount(raw: string): string {
  if (!/^\d+$/.test(raw)) return "0";
  const amount = Number(raw) / 1_000_000;
  return Number.isFinite(amount)
    ? amount.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : "0";
}

function computeLockStatus(token: {
  name: string;
  ticker: string;
  lock_amount: string;
  lock_duration_days: number;
  lock_tx: string;
  lock_verified_at: string | null;
  lock_unlock_at: string | null;
}) {
  const endTime = token.lock_unlock_at
    ? new Date(token.lock_unlock_at).getTime()
    : Number.NaN;
  const startTime = token.lock_verified_at
    ? new Date(token.lock_verified_at).getTime()
    : Number.NaN;
  const now = Date.now();
  const hasVerifiedLock = Boolean(
    token.lock_verified_at &&
    token.lock_tx &&
    /^\d+$/.test(token.lock_amount) &&
    BigInt(token.lock_amount) > BigInt(0) &&
    token.lock_duration_days > 0 &&
    Number.isFinite(startTime) &&
    Number.isFinite(endTime),
  );
  const percentUnlocked = hasVerifiedLock && now >= endTime ? 100 : 0;
  const daysRemaining = hasVerifiedLock
    ? Math.max(0, Math.ceil((endTime - now) / DAY_MS))
    : null;

  return {
    tokenName: token.name,
    ticker: token.ticker,
    lockAmount: hasVerifiedLock ? formatTokenAmount(token.lock_amount) : null,
    lockDuration: hasVerifiedLock ? `${token.lock_duration_days}d` : null,
    percentUnlocked,
    daysRemaining,
    start: hasVerifiedLock ? new Date(startTime).toISOString() : null,
    end: hasVerifiedLock ? new Date(endTime).toISOString() : null,
    status: !hasVerifiedLock ? "unverified" : now >= endTime ? "fully_unlocked" : "locked",
    transaction: hasVerifiedLock ? token.lock_tx : null,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ ca: string }> },
) {
  try {
    const { ca } = await params;
    if (!isValidTokenIdentifier(ca)) {
      return apiError("A valid token address or ID is required", 400);
    }
    if (!hasSupabaseConfig()) return apiError("Token lock data unavailable", 503);

    let query = getSupabase()
      .from("tokens")
      .select("name, ticker, lock_amount, lock_duration_days, lock_tx, lock_verified_at, lock_unlock_at");

    query = isValidSolanaAddress(ca)
      ? query.eq("mint_address", ca)
      : query.eq("id", ca);

    const { data, error } = await query.maybeSingle();
    if (error) {
      console.error("[token/lock] Supabase error:", error.message);
      return apiError("Failed to fetch token lock status", 503);
    }
    if (!data) return apiError("Token not found", 404);

    return apiResponse({ lock: computeLockStatus(data) });
  } catch (error) {
    console.error("[token/lock] Error:", error);
    return apiError("Failed to fetch token lock status", 503);
  }
}
