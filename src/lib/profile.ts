import { type Token } from "@/types/index";
import type { GitHubProfile } from "@/types/index";
import type { DisplayToken } from "@/types/display";
import { tokenToDisplay } from "./queries";
import { hasSupabaseConfig } from "./supabase";

const PROFILE_COLUMNS = "id, github_username, github_avatar, account_created_at, public_repos, wallet_address, total_commits, last_refreshed";
const TOKEN_COLUMNS = "id, mint_address, name, ticker, image_uri, trust_tier, creator_wallet, github_username, lock_amount, lock_duration_days, lock_percentage, buy_amount_sol, created_at, live_url, github_repo, lock_tx, launch_tx, launch_verified_at, lock_verified_at, lock_unlock_at, description, twitter_url, telegram_url, website_url";

export async function getProfileByUsername(
  username: string,
): Promise<GitHubProfile | null> {
  if (!hasSupabaseConfig()) return null;

  try {
    const { getSupabase } = await import("./supabase");
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("github_profiles")
      .select(PROFILE_COLUMNS)
      .eq("github_username", username)
      .maybeSingle();

    if (error) {
      console.error("[getProfileByUsername] Supabase error:", error.message);
      return null;
    }
    if (!data) return null;
    return data as GitHubProfile;
  } catch (error) {
    console.error("[getProfileByUsername] Error:", error);
    return null;
  }
}

export async function getTokensByCreator(
  username: string,
): Promise<DisplayToken[]> {
  if (!hasSupabaseConfig()) return [];

  try {
    const { getSupabase } = await import("./supabase");
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("tokens")
      .select(TOKEN_COLUMNS)
      .eq("github_username", username)
      .not("launch_verified_at", "is", null)
      .not("lock_verified_at", "is", null)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[getTokensByCreator] Supabase error:", error.message);
      return [];
    }
    if (!data) return [];
    return (data as Token[]).map((t) => tokenToDisplay(t));
  } catch (error) {
    console.error("[getTokensByCreator] Error:", error);
    return [];
  }
}

/** Server-only: links a wallet to a GitHub profile. */
export async function linkWallet(
  githubId: string,
  walletAddress: string,
): Promise<{
  success: boolean;
  code?: "conflict" | "not_found" | "database";
  error?: string;
}> {
  try {
    const { getServerClient } = await import("./supabase");
    const supabase = getServerClient();

    const { data: profile, error: profileError } = await supabase
      .from("github_profiles")
      .select("id, wallet_address")
      .eq("github_id", githubId)
      .maybeSingle();

    if (profileError) {
      console.error("[linkWallet] Profile query error:", profileError.message);
      return { success: false, code: "database", error: "Failed to verify profile" };
    }
    if (!profile) {
      return { success: false, code: "not_found", error: "GitHub profile not found" };
    }
    if (profile.wallet_address === walletAddress) return { success: true };
    if (profile.wallet_address) {
      return {
        success: false,
        code: "conflict",
        error: "Linked wallets cannot be changed",
      };
    }

    const { data: owner, error: ownerError } = await supabase
      .from("github_profiles")
      .select("github_id")
      .eq("wallet_address", walletAddress)
      .neq("github_id", githubId)
      .maybeSingle();

    if (ownerError) {
      console.error("[linkWallet] Ownership query error:", ownerError.message);
      return { success: false, code: "database", error: "Failed to verify wallet ownership" };
    }
    if (owner) {
      return { success: false, code: "conflict", error: "Wallet is already linked to another profile" };
    }

    const { data, error } = await supabase
      .from("github_profiles")
      .update({ wallet_address: walletAddress })
      .eq("github_id", githubId)
      .is("wallet_address", null)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[linkWallet] Supabase error:", error.message);
      if (error.code === "23505") {
        return { success: false, code: "conflict", error: "Wallet is already linked" };
      }
      return { success: false, code: "database", error: "Failed to link wallet" };
    }
    if (!data) {
      return { success: false, code: "conflict", error: "Wallet link changed concurrently" };
    }
    return { success: true };
  } catch (err) {
    console.error("[linkWallet] Error:", err);
    return { success: false, code: "database", error: "Failed to link wallet" };
  }
}
