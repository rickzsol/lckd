import { type Token, TrustTier } from "@/types/index";
import type { GitHubProfile } from "@/types/index";
import type { DisplayToken } from "@/types/display";
import { tokenToDisplay } from "./queries";
import { hasSupabaseConfig } from "./supabase";

const MOCK_PROFILE: GitHubProfile = {
  id: "mock-1",
  wallet_address: "",
  github_id: "0",
  github_username: "lckd",
  github_avatar: "/logo.png",
  account_created_at: "2023-01-15T00:00:00Z",
  public_repos: 12,
  total_commits: 847,
  last_refreshed: new Date().toISOString(),
};

const PROFILE_COLUMNS = "id, github_id, github_username, github_avatar, account_created_at, public_repos, wallet_address, total_commits, last_refreshed";
const TOKEN_COLUMNS = "mint_address, name, ticker, image_uri, trust_tier, creator_wallet, github_username, lock_amount, lock_duration_days, lock_percentage, buy_amount_sol, created_at, live_url, github_repo, lock_tx, launch_tx";

export async function getProfileByUsername(
  username: string,
): Promise<GitHubProfile | null> {
  if (!hasSupabaseConfig()) {
    return username === "lckd" ? MOCK_PROFILE : null;
  }

  try {
    const { getSupabase } = await import("./supabase");
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("github_profiles")
      .select(PROFILE_COLUMNS)
      .eq("github_username", username)
      .single();

    if (error || !data) return null;
    return data as GitHubProfile;
  } catch {
    return null;
  }
}

export async function getTokensByCreator(
  username: string,
): Promise<DisplayToken[]> {
  if (!hasSupabaseConfig()) {
    const { FEATURED_TOKEN } = await import("./mock-data");
    return FEATURED_TOKEN.dev.github === username ? [FEATURED_TOKEN] : [];
  }

  try {
    const { getSupabase } = await import("./supabase");
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("tokens")
      .select(TOKEN_COLUMNS)
      .eq("github_username", username)
      .order("created_at", { ascending: false });

    if (error || !data) return [];
    return (data as Token[]).map((t) => tokenToDisplay(t));
  } catch {
    return [];
  }
}

/** Server-only: links a wallet to a GitHub profile. */
export async function linkWallet(
  githubId: string,
  walletAddress: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { getServerClient } = await import("./supabase");
    const supabase = getServerClient();

    const { error } = await supabase
      .from("github_profiles")
      .update({ wallet_address: walletAddress })
      .eq("github_id", githubId);

    if (error) {
      console.error("[linkWallet] Supabase error:", error.message);
      return { success: false, error: "Failed to link wallet" };
    }
    return { success: true };
  } catch (err) {
    console.error("[linkWallet] Error:", err);
    return { success: false, error: "Failed to link wallet" };
  }
}
