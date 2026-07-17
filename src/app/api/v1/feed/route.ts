import { type NextRequest } from "next/server";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";
import { parseNonNegativeInt, parsePositiveInt } from "@/lib/api/validation";
import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";
import { TrustTier } from "@/types/index";
import type { DisplayToken } from "@/types/display";

export { OPTIONS };

const TIER_MAP: Record<string, TrustTier> = {
  locked: TrustTier.LOCKED,
  verified: TrustTier.VERIFIED,
  builder: TrustTier.BUILDER,
  shipped: TrustTier.SHIPPED,
};

const MAX_LIMIT = 100;
const TOKEN_COLUMNS = "id, mint_address, name, ticker, description, image_uri, trust_tier, creator_wallet, github_username, lock_amount, lock_duration_days, lock_percentage, buy_amount_sol, created_at, live_url, github_repo, lock_tx, launch_tx, launch_verified_at, lock_verified_at, lock_unlock_at, twitter_url, telegram_url, website_url";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const tierParam = searchParams.get("tier")?.toLowerCase();
    const sort = searchParams.get("sort") ?? "newest";
    const limit = Math.min(parsePositiveInt(searchParams.get("limit"), 20), MAX_LIMIT);
    const effectiveOffset = parseNonNegativeInt(searchParams.get("offset"), 0);

    if (tierParam && !TIER_MAP[tierParam]) {
      return apiError(`Invalid tier. Use: ${Object.keys(TIER_MAP).join(", ")}`, 400);
    }
    if (sort !== "newest" && sort !== "oldest") {
      return apiError("Invalid sort. Use: newest, oldest", 400);
    }

    const emptyFeed = {
      tokens: [] as DisplayToken[],
      meta: { total: 0, limit, offset: effectiveOffset, sort, available: false },
    };

    if (!hasSupabaseConfig()) return apiResponse(emptyFeed);

    const supabase = getSupabase();
    let countQuery = supabase
      .from("tokens")
      .select("id", { count: "exact", head: true })
      .not("launch_verified_at", "is", null)
      .not("lock_verified_at", "is", null);
    if (tierParam) countQuery = countQuery.eq("trust_tier", TIER_MAP[tierParam]);

    let query = supabase
      .from("tokens")
      .select(TOKEN_COLUMNS)
      .not("launch_verified_at", "is", null)
      .not("lock_verified_at", "is", null);
    if (tierParam) query = query.eq("trust_tier", TIER_MAP[tierParam]);

    query = query
      .order("created_at", { ascending: sort === "oldest" })
      .range(effectiveOffset, effectiveOffset + limit - 1);

    const [{ count, error: countError }, { data, error }] = await Promise.all([
      countQuery,
      query,
    ]);

    if (countError || error) {
      console.error("[feed] Supabase error:", countError?.message ?? error?.message);
      return apiResponse(emptyFeed);
    }

    const { tokenToDisplay } = await import("@/lib/queries");
    const tokens = (data ?? []).map((token: import("@/types/index").Token) => tokenToDisplay(token));

    return apiResponse({
      tokens,
      meta: { total: count ?? 0, limit, offset: effectiveOffset, sort, available: true },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[feed] Error:", message);
    return apiResponse({
      tokens: [] as DisplayToken[],
      meta: { total: 0, limit: 20, offset: 0, sort: "newest", available: false },
    });
  }
}
