import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getGitHubRepoDetails, getRecentCommits, getCommitCountSinceLaunch } from "@/lib/github/api";
import { calculateTrustTier } from "@/lib/github/tierCalculator";
import { verifyLiveUrl } from "@/lib/github/urlVerifier";
import { TrustTier, type Token, type GitHubProfile } from "@/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  const githubToken = process.env.GITHUB_PAT;

  // Fetch tokens at tier >= 2 with active locks
  const now = new Date();
  const { data: tokens, error } = await supabase
    .from("tokens")
    .select("*")
    .gte("trust_tier", TrustTier.VERIFIED);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const activeTokens = (tokens as Token[]).filter((t) => {
    const lockEnd = new Date(t.created_at);
    lockEnd.setDate(lockEnd.getDate() + t.lock_duration_days);
    return lockEnd > now;
  });

  let refreshed = 0;
  let tierChanges = 0;

  for (const token of activeTokens) {
    try {
      // Fetch GitHub profile for this token
      let profile: GitHubProfile | null = null;
      if (token.github_username) {
        const { data } = await supabase
          .from("github_profiles")
          .select("*")
          .eq("github_username", token.github_username)
          .single();
        profile = data as GitHubProfile | null;
      }

      // Parse owner/repo from github_repo (format: "owner/repo")
      let repoData = null;
      let hasRecentCommits = false;
      let hasPostLaunchCommits = false;

      if (token.github_repo) {
        const [owner, repo] = token.github_repo.split("/");
        if (owner && repo) {
          try {
            repoData = await getGitHubRepoDetails(owner, repo, githubToken);

            const commits = await getRecentCommits(owner, repo, 1, githubToken);
            if (commits.length > 0) {
              const thirtyDaysAgo = new Date();
              thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
              hasRecentCommits = new Date(commits[0].date) > thirtyDaysAgo;
            }

            if (token.created_at) {
              const postLaunchCount = await getCommitCountSinceLaunch(
                owner,
                repo,
                token.created_at,
                githubToken,
              );
              hasPostLaunchCommits = postLaunchCount > 0;
            }
          } catch {
            // Repo may have been deleted or made private
          }
        }
      }

      // Verify live URL for tier 4 candidates
      let isLiveUrlVerified = false;
      if (token.live_url) {
        isLiveUrlVerified = await verifyLiveUrl(token.live_url);
      }

      const newTier = calculateTrustTier(token, profile, {
        repoData,
        hasRecentCommits,
        hasPostLaunchCommits,
        isLiveUrlVerified,
      });

      const isChanged = newTier !== token.trust_tier;
      if (isChanged) tierChanges++;

      await supabase
        .from("tokens")
        .update({ trust_tier: newTier })
        .eq("id", token.id);

      refreshed++;
    } catch {
      // Continue processing remaining tokens
    }
  }

  const message = `Refreshed ${refreshed} tokens, ${tierChanges} tier changes`;
  console.log(message);

  return NextResponse.json({ message, refreshed, tierChanges });
}
