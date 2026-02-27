import { type NextRequest } from "next/server";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";
import { parsePositiveInt } from "@/lib/api/validation";
import { hasSupabaseConfig } from "@/lib/supabase";
import { TrustTier } from "@/types/index";
import type { DisplayToken } from "@/types/display";
import { FEATURED_TOKEN } from "@/lib/mock-data";

export { OPTIONS };

const TIER_MAP: Record<string, TrustTier> = {
  locked: TrustTier.LOCKED,
  verified: TrustTier.VERIFIED,
  builder: TrustTier.BUILDER,
  shipped: TrustTier.SHIPPED,
};

const MAX_LIMIT = 100;
const TOKEN_COLUMNS = "id, mint_address, name, ticker, description, image_uri, trust_tier, creator_wallet, github_username, lock_amount, lock_duration_days, lock_percentage, buy_amount_sol, created_at, live_url, github_repo, lock_tx, launch_tx, twitter_url, telegram_url, website_url";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const tierParam = searchParams.get("tier")?.toLowerCase();
    const sort = searchParams.get("sort") ?? "newest";
    const limit = Math.min(parsePositiveInt(searchParams.get("limit"), 20), MAX_LIMIT);
    const offsetParam = searchParams.get("offset");
    const effectiveOffset = offsetParam ? Math.max(0, parseInt(offsetParam, 10) || 0) : 0;

    if (tierParam && !TIER_MAP[tierParam]) {
      return apiError(`Invalid tier. Use: ${Object.keys(TIER_MAP).join(", ")}`, 400);
    }

    let tokens: DisplayToken[] = [FEATURED_TOKEN];
    let total = 1;

    if (hasSupabaseConfig()) {
      try {
        const { getSupabase } = await import("@/lib/supabase");
        const supabase = getSupabase();

        // Get total count for proper pagination
        let countQuery = supabase.from("tokens").select("*", { count: "exact", head: true });
        if (tierParam) countQuery = countQuery.eq("trust_tier", TIER_MAP[tierParam]);
        const { count } = await countQuery;

        let query = supabase.from("tokens").select(TOKEN_COLUMNS);
        if (tierParam) query = query.eq("trust_tier", TIER_MAP[tierParam]);

        const ascending = sort === "oldest";
        query = query.order("created_at", { ascending }).range(effectiveOffset, effectiveOffset + limit - 1);

        const { data, error } = await query;

        if (error) {
          console.error("[feed] Supabase error:", error.message);
          return apiError("Failed to fetch feed", 500);
        }

        if (data && data.length > 0) {
          const { tokenToDisplay } = await import("@/lib/queries");
          tokens = [FEATURED_TOKEN, ...data.map((t: import("@/types/index").Token) => tokenToDisplay(t))];
          total = (count ?? 0) + 1; // +1 for featured token
        }
      } catch (err) {
        console.error("[feed] Error:", err instanceof Error ? err.message : err);
        return apiError("Failed to fetch feed", 500);
      }
    }

    return apiResponse({
      tokens,
      meta: { total, limit, offset: effectiveOffset, sort },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[feed] Error:", message);
    return apiError("Internal server error", 500);
  }
}
