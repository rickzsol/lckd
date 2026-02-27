import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getServerClient } from "@/lib/supabase";
import { getGitHubRepoDetails, getRecentCommits, getCommitCountSinceLaunch } from "@/lib/github/api";
import { calculateTrustTier } from "@/lib/github/tierCalculator";
import { verifyLiveUrl } from "@/lib/github/urlVerifier";
import { TrustTier, type Token, type GitHubProfile } from "@/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE_SIZE = 50;
const BATCH_CONCURRENCY = 5;

function isValidSecret(received: string | null | undefined): boolean {
  const expected = process.env.CRON_SECRET;
  if (!received || !expected) return false;

  const expectedBuf = Buffer.from(expected);
  const receivedBuf = Buffer.from(received);

  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}

export async function GET(req: Request) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!isValidSecret(secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServerClient();
  const githubToken = process.env.GITHUB_PAT;
  const now = new Date();

  let refreshed = 0;
  let tierChanges = 0;
  let page = 0;

  while (true) {
    const { data: tokens, error } = await supabase
      .from("tokens")
      .select("id, mint_address, name, ticker, trust_tier, github_username, github_repo, live_url, lock_duration_days, created_at")
      .gte("trust_tier", TrustTier.VERIFIED)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) {
      console.error("[cron] Token fetch error:", error.message);
      return NextResponse.json({ error: "Failed to fetch tokens" }, { status: 500 });
    }

    if (!tokens || tokens.length === 0) break;

    // Filter to tokens with active locks
    const activeTokens = (tokens as Token[]).filter((t) => {
      const lockEnd = new Date(t.created_at);
      lockEnd.setDate(lockEnd.getDate() + t.lock_duration_days);
      return lockEnd > now;
    });

    // Process in batches of BATCH_CONCURRENCY
    for (let i = 0; i < activeTokens.length; i += BATCH_CONCURRENCY) {
      const batch = activeTokens.slice(i, i + BATCH_CONCURRENCY);

      const results = await Promise.allSettled(
        batch.map((token) => refreshToken(supabase, token, githubToken)),
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          refreshed++;
          if (result.value) tierChanges++;
        }
      }
    }

    if (tokens.length < PAGE_SIZE) break;
    page++;
  }

  const message = `Refreshed ${refreshed} tokens, ${tierChanges} tier changes`;
  console.log(message);
  return NextResponse.json({ message, refreshed, tierChanges });
}

async function refreshToken(
  supabase: ReturnType<typeof getServerClient>,
  token: Token,
  githubToken?: string,
): Promise<boolean> {
  let profile: GitHubProfile | null = null;
  if (token.github_username) {
    const { data } = await supabase
      .from("github_profiles")
      .select("id, github_id, github_username, github_avatar, account_created_at, public_repos, wallet_address, total_commits, last_refreshed")
      .eq("github_username", token.github_username)
      .single();
    profile = data as GitHubProfile | null;
  }

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
            owner, repo, token.created_at, githubToken,
          );
          hasPostLaunchCommits = postLaunchCount > 0;
        }
      } catch {
        // Repo may have been deleted or made private
      }
    }
  }

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

  await supabase
    .from("tokens")
    .update({ trust_tier: newTier })
    .eq("id", token.id);

  return isChanged;
}
