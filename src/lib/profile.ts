import { type Token, TrustTier } from "@/types/index";
import type { GitHubProfile } from "@/types/index";
import type { DisplayToken } from "@/types/display";
import { tokenToDisplay } from "./queries";

const MOCK_PROFILE: GitHubProfile = {
  id: "mock-1",
  wallet_address: "",
  github_id: "0",
  github_username: "lockpad",
  github_avatar: "/logo.png",
  account_created_at: "2023-01-15T00:00:00Z",
  public_repos: 12,
  total_commits: 847,
  last_refreshed: new Date().toISOString(),
};

function hasSupabaseConfig(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

async function getSupabaseClient() {
  const { getSupabase } = await import("./supabase");
  return getSupabase();
}

export async function getProfileByUsername(
  username: string,
): Promise<GitHubProfile | null> {
  if (!hasSupabaseConfig()) {
    return username === "lockpad" ? MOCK_PROFILE : null;
  }

  try {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from("github_profiles")
      .select("*")
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
    const { TOKENS } = await import("./mock-data");
    return TOKENS.filter((t) => t.dev.github === username);
  }

  try {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from("tokens")
      .select("*")
      .eq("github_username", username)
      .order("created_at", { ascending: false });

    if (error || !data) return [];
    return (data as Token[]).map((t) => tokenToDisplay(t));
  } catch {
    return [];
  }
}

export async function linkWallet(
  githubId: string,
  walletAddress: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { createServerClient } = await import("./supabase");
    const supabase = createServerClient();

    const { error } = await supabase
      .from("github_profiles")
      .update({ wallet_address: walletAddress })
      .eq("github_id", githubId);

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
