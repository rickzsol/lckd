import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getServerClient } from "@/lib/supabase";
import { getGitHubRepoDetails, getRecentCommits, getCommitCountSinceLaunch } from "@/lib/github/api";
import { calculateTrustTier } from "@/lib/github/tierCalculator";
import { verifyLiveUrl } from "@/lib/github/urlVerifier";
import { type Token, type GitHubProfile } from "@/types";

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
  const authorization = req.headers.get("authorization");
  const secret = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
  if (!isValidSecret(secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let supabase: ReturnType<typeof getServerClient>;
  try {
    supabase = getServerClient();
  } catch (error) {
    console.error("[cron] Supabase configuration error:", error);
    return NextResponse.json({ error: "Cron service unavailable" }, { status: 503 });
  }
  const githubToken = process.env.GITHUB_PAT;
  const now = new Date();
  const { data: downgradedTokens, error: downgradeError } = await supabase
    .from("tokens")
    .update({ trust_tier: 1 })
    .not("lock_verified_at", "is", null)
    .lte("lock_unlock_at", now.toISOString())
    .gt("trust_tier", 1)
    .select("id");
  if (downgradeError) {
    console.error("[cron] Expired lock downgrade failed:", downgradeError.message);
    return NextResponse.json({ error: "Failed to downgrade expired locks" }, { status: 500 });
  }
  const expiredDowngrades = downgradedTokens?.length ?? 0;

  let refreshed = 0;
  let tierChanges = 0;
  let page = 0;

  while (true) {
    const { data: tokens, error } = await supabase
      .from("tokens")
      .select("id, mint_address, name, ticker, trust_tier, github_username, github_repo, live_url, lock_tx, lock_duration_days, lock_percentage, lock_amount, lock_verified_at, lock_unlock_at, created_at")
      .not("launch_verified_at", "is", null)
      .not("lock_verified_at", "is", null)
      .order("id", { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) {
      console.error("[cron] Token fetch error:", error.message);
      return NextResponse.json({ error: "Failed to fetch tokens" }, { status: 500 });
    }

    if (!tokens || tokens.length === 0) break;

    // Filter to tokens with active locks
    const activeTokens = (
      tokens as Array<Token & { lock_verified_at: string | null; lock_unlock_at: string | null }>
    ).filter((token) => token.lock_unlock_at && new Date(token.lock_unlock_at) > now);

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
        } else {
          console.error("[cron] Token refresh failed:", result.reason);
        }
      }
    }

    if (tokens.length < PAGE_SIZE) break;
    page++;
  }

  const message = `Refreshed ${refreshed} tokens, ${tierChanges} tier changes, ${expiredDowngrades} expired lock downgrades`;
  console.log(message);
  return NextResponse.json({ message, refreshed, tierChanges, expiredDowngrades });
}

async function refreshToken(
  supabase: ReturnType<typeof getServerClient>,
  token: Token,
  githubToken?: string,
): Promise<boolean> {
  let profile: GitHubProfile | null = null;
  if (token.github_username) {
    const { data, error } = await supabase
      .from("github_profiles")
      .select("id, github_id, github_username, github_avatar, account_created_at, public_repos, wallet_address, total_commits, last_refreshed")
      .eq("github_username", token.github_username)
      .maybeSingle();
    if (error) throw new Error(`Profile lookup failed: ${error.message}`);
    profile = data as GitHubProfile | null;
  }

  let repoData = null;
  let hasRecentCommits = false;
  let hasPostLaunchCommits = false;

  if (token.github_repo) {
    const [owner, repo] = token.github_repo.split("/");
    if (
      owner &&
      repo &&
      owner.toLowerCase() === token.github_username?.toLowerCase()
    ) {
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
      } catch (error) {
        console.warn(`[cron] GitHub refresh failed for ${token.github_repo}:`, error);
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
    isLockVerified: true,
  });

  const isChanged = newTier !== token.trust_tier;

  const { error: updateError } = await supabase
    .from("tokens")
    .update({ trust_tier: newTier })
    .eq("id", token.id)
    .not("lock_verified_at", "is", null);

  if (updateError) throw new Error(`Tier update failed: ${updateError.message}`);

  return isChanged;
}
