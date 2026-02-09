import { type NextRequest } from "next/server";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";
import { parsePositiveInt } from "@/lib/api/validation";
import { TrustTier } from "@/types/index";
import type { DisplayToken } from "@/types/display";
import { TOKENS as MOCK_TOKENS } from "@/lib/mock-data";

export { OPTIONS };

const TIER_MAP: Record<string, TrustTier> = {
  locked: TrustTier.LOCKED,
  verified: TrustTier.VERIFIED,
  builder: TrustTier.BUILDER,
  shipped: TrustTier.SHIPPED,
};

const MAX_LIMIT = 100;

function hasSupabaseConfig(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

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

    let tokens: DisplayToken[];

    if (hasSupabaseConfig()) {
      try {
        const { getSupabase } = await import("@/lib/supabase");
        const supabase = getSupabase();

        let query = supabase.from("tokens").select("*");

        if (tierParam) {
          query = query.eq("trust_tier", TIER_MAP[tierParam]);
        }

        const ascending = sort === "oldest";
        query = query.order("created_at", { ascending }).range(effectiveOffset, effectiveOffset + limit - 1);

        const { data, error } = await query;

        if (error || !data || data.length === 0) {
          tokens = MOCK_TOKENS;
        } else {
          const { tokenToDisplay } = await import("@/lib/queries");
          tokens = data.map((t: import("@/types/index").Token) => tokenToDisplay(t));
        }
      } catch {
        tokens = MOCK_TOKENS;
      }
    } else {
      tokens = MOCK_TOKENS;
    }

    // Apply client-side filtering/sorting on mock data
    if (!hasSupabaseConfig() || tokens === MOCK_TOKENS) {
      if (tierParam && TIER_MAP[tierParam]) {
        tokens = tokens.filter((t) => t.tier === TIER_MAP[tierParam]);
      }

      if (sort === "oldest") {
        tokens = [...tokens].reverse();
      }

      tokens = tokens.slice(effectiveOffset, effectiveOffset + limit);
    }

    return apiResponse({
      tokens,
      meta: { total: tokens.length, limit, offset: effectiveOffset, sort },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return apiError(message, 500);
  }
}
