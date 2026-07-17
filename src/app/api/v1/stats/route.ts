import { apiResponse } from "@/lib/api/helpers";
import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 60;

const EMPTY_STATS = {
  launched: 0,
  totalLocked: 0,
  devsVerified: 0,
  buildingNow: 0,
  available: false,
};

function isActiveVerifiedLock(token: {
  lock_tx: string;
  lock_amount: string;
  lock_unlock_at: string | null;
}): boolean {
  if (!token.lock_tx || !/^\d+$/.test(token.lock_amount)) return false;
  if (BigInt(token.lock_amount) <= BigInt(0) || !token.lock_unlock_at) return false;

  const lockEnd = new Date(token.lock_unlock_at).getTime();
  return Number.isFinite(lockEnd) && lockEnd > Date.now();
}

export async function GET() {
  if (!hasSupabaseConfig()) return apiResponse(EMPTY_STATS);

  try {
    const { data, error } = await getSupabase()
      .from("tokens")
      .select("creator_wallet, github_username, lock_amount, lock_tx, lock_unlock_at, trust_tier")
      .not("launch_verified_at", "is", null)
      .not("lock_verified_at", "is", null);

    if (error) {
      console.error("[stats] Supabase error:", error.message);
      return apiResponse(EMPTY_STATS);
    }

    const tokens = data ?? [];
    const activeLocks = tokens.filter(isActiveVerifiedLock);
    const totalLockedRaw = activeLocks.reduce(
      (sum, token) => sum + BigInt(token.lock_amount),
      BigInt(0),
    );
    const verifiedDevs = new Set(
      tokens
        .filter((token) => token.trust_tier >= 2 && token.github_username)
        .map((token) => token.github_username),
    );
    const activeBuilders = new Set(activeLocks.map((token) => token.creator_wallet));

    return apiResponse({
      launched: tokens.length,
      totalLocked: Number(totalLockedRaw) / 1_000_000,
      devsVerified: verifiedDevs.size,
      buildingNow: activeBuilders.size,
      available: true,
    });
  } catch (error) {
    console.error("[stats] Error:", error);
    return apiResponse(EMPTY_STATS);
  }
}
