import { type NextRequest } from "next/server";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";
import { isValidSolanaAddress, isValidTokenIdentifier } from "@/lib/api/validation";
import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";
import { tokenToDisplay } from "@/lib/queries";
import type { Token } from "@/types";

export { OPTIONS };

const TOKEN_COLUMNS = "id, mint_address, name, ticker, description, image_uri, trust_tier, creator_wallet, has_lock, creator_provider, creator_username, github_username, lock_amount, lock_duration_days, lock_percentage, buy_amount_sol, created_at, live_url, github_repo, lock_tx, launch_tx, launch_verified_at, lock_verified_at, lock_unlock_at, twitter_url, telegram_url, website_url";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ ca: string }> },
) {
  try {
    const { ca } = await params;
    if (!isValidTokenIdentifier(ca)) {
      return apiError("A valid token address or ID is required", 400);
    }
    if (!hasSupabaseConfig()) return apiError("Token data unavailable", 503);

    let query = getSupabase()
      .from("tokens")
      .select(TOKEN_COLUMNS)
      .not("launch_verified_at", "is", null);

    query = isValidSolanaAddress(ca)
      ? query.eq("mint_address", ca)
      : query.eq("id", ca);

    const { data, error } = await query.maybeSingle();
    if (error) {
      console.error("[token/get] Supabase error:", error.message);
      return apiError("Failed to fetch token", 503);
    }
    if (!data) return apiError("Token not found", 404);

    return apiResponse({ token: tokenToDisplay(data as Token) });
  } catch (error) {
    console.error("[token/get] Error:", error);
    return apiError("Failed to fetch token", 503);
  }
}
