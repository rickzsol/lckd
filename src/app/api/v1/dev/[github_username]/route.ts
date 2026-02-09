import { type NextRequest } from "next/server";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";
import { isValidGitHubUsername } from "@/lib/api/validation";
import { TOKENS as MOCK_TOKENS } from "@/lib/mock-data";

export { OPTIONS };

function hasSupabaseConfig(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ github_username: string }> },
) {
  try {
    const { github_username } = await params;

    if (!isValidGitHubUsername(github_username)) {
      return apiError("Invalid GitHub username", 400);
    }

    if (hasSupabaseConfig()) {
      try {
        const { getSupabase } = await import("@/lib/supabase");
        const supabase = getSupabase();

        const { data, error } = await supabase
          .from("tokens")
          .select("*")
          .eq("github_username", github_username)
          .order("created_at", { ascending: false });

        if (!error && data && data.length > 0) {
          const { tokenToDisplay } = await import("@/lib/queries");
          const tokens = data.map((t: import("@/types/index").Token) => tokenToDisplay(t));
          return apiResponse({ developer: github_username, tokens });
        }
      } catch {
        // fall through to mock
      }
    }

    const mockTokens = MOCK_TOKENS.filter(
      (t) => t.dev.github?.toLowerCase() === github_username.toLowerCase(),
    );

    if (mockTokens.length === 0) {
      return apiError("No tokens found for this developer", 404);
    }

    return apiResponse({ developer: github_username, tokens: mockTokens });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return apiError(message, 500);
  }
}
