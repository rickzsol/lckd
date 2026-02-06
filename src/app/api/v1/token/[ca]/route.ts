import { type NextRequest } from "next/server";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";
import { TOKENS as MOCK_TOKENS } from "@/lib/mock-data";
import type { DisplayToken } from "@/types/display";

export { OPTIONS };

function hasSupabaseConfig(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

function findMockToken(ca: string): DisplayToken | undefined {
  return MOCK_TOKENS.find(
    (t) => String(t.id) === ca || t.mintAddress === ca,
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
        // fall through to mock
      }
    }

    const mock = findMockToken(ca);
    if (mock) return apiResponse({ token: mock });

    return apiError("Token not found", 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return apiError(message, 500);
  }
}
