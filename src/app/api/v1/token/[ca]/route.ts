import { type NextRequest } from "next/server";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";
import { FEATURED_TOKEN } from "@/lib/mock-data";

export { OPTIONS };

function hasSupabaseConfig(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
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

    if (hasSupabaseConfig()) {
      try {
        const { getTokenByIdOrMint } = await import("@/lib/queries");
        const token = await getTokenByIdOrMint(ca);
        if (token) return apiResponse({ token });
      } catch {
        // fall through to featured
      }
    }

    if (String(FEATURED_TOKEN.id) === ca || FEATURED_TOKEN.mintAddress === ca) {
      return apiResponse({ token: FEATURED_TOKEN });
    }

    return apiError("Token not found", 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return apiError(message, 500);
  }
}
