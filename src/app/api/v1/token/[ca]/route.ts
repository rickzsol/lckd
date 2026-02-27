import { type NextRequest } from "next/server";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";
import { hasSupabaseConfig } from "@/lib/supabase";
import { FEATURED_TOKEN } from "@/lib/mock-data";

export { OPTIONS };

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ ca: string }> },
) {
  try {
    const { ca } = await params;

    if (!ca || ca.trim().length === 0) {
      return apiError("Token address or ID is required", 400);
    }

    if (hasSupabaseConfig()) {
      try {
        const { getTokenByIdOrMint } = await import("@/lib/queries");
        const token = await getTokenByIdOrMint(ca);
        if (token) return apiResponse({ token });
      } catch (err) {
        console.error("[token/get] Supabase error:", err instanceof Error ? err.message : err);
        return apiError("Failed to fetch token", 500);
      }
    }

    if (String(FEATURED_TOKEN.id) === ca || FEATURED_TOKEN.mintAddress === ca) {
      return apiResponse({ token: FEATURED_TOKEN });
    }

    return apiError("Token not found", 404);
  } catch (err) {
    console.error("[token/get] Error:", err instanceof Error ? err.message : err);
    return apiError("Internal server error", 500);
  }
}
