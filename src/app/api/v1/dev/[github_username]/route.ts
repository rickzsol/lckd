import { type NextRequest } from "next/server";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";
import { isValidGitHubUsername } from "@/lib/api/validation";
import { hasSupabaseConfig } from "@/lib/supabase";
import { FEATURED_TOKEN } from "@/lib/mock-data";

export { OPTIONS };

const DEV_TOKEN_COLUMNS = "id, mint_address, name, ticker, description, image_uri, trust_tier, creator_wallet, github_username, lock_amount, lock_duration_days, lock_percentage, buy_amount_sol, created_at, live_url, github_repo, lock_tx, launch_tx, twitter_url, telegram_url, website_url";

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
          .select(DEV_TOKEN_COLUMNS)
          .eq("github_username", github_username)
          .order("created_at", { ascending: false });

        if (error) {
          console.error("[dev] Supabase error:", error.message);
          return apiError("Failed to fetch developer tokens", 500);
        }

        if (data && data.length > 0) {
          const { tokenToDisplay } = await import("@/lib/queries");
          const tokens = data.map((t: import("@/types/index").Token) => tokenToDisplay(t));
          return apiResponse({ developer: github_username, tokens });
        }
      } catch (err) {
        console.error("[dev] Error:", err instanceof Error ? err.message : err);
        return apiError("Failed to fetch developer tokens", 500);
      }
    }

    if (FEATURED_TOKEN.dev.github?.toLowerCase() === github_username.toLowerCase()) {
      return apiResponse({ developer: github_username, tokens: [FEATURED_TOKEN] });
    }

    return apiError("No tokens found for this developer", 404);
  } catch (err) {
    console.error("[dev] Error:", err instanceof Error ? err.message : err);
    return apiError("Internal server error", 500);
  }
}
