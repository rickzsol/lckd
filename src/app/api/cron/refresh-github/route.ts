import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase";
import { isValidCronSecret } from "@/lib/api/cronAuth";
import { getGitHubRepoDetails, getRecentCommits, getCommitCountSinceLaunch } from "@/lib/github/api";
import { calculateTrustTier } from "@/lib/github/tierCalculator";
import { verifyLiveUrl } from "@/lib/github/urlVerifier";
import { projectTrust, TRUST_POLICY_VERSION } from "@/lib/trust/projection";
import { type Token, type GitHubProfile } from "@/types";
import type { LockStatus } from "@/types/trust";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE_SIZE = 50;
const BATCH_CONCURRENCY = 5;

export async function GET(req: Request) {
  if (!isValidCronSecret(req.headers.get("authorization"))) {
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
  // The standalone wall-clock downgrade is retired: tier flooring for expired
  // locks is a property of the single trust projection (see refreshToken), which
  // the reconcile-locks sweep and this GitHub refresh both compute.
  const expiredDowngrades = 0;

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

    // Every launch + lock verified token is re-projected, including ones past
    // their cliff: the projection floors an expired lock to LOCKED, so skipping
    // expired tokens would leave a stale high tier standing (finding 5). The
    // canonical lock row (read per token) is the authority for withdrawn/anomalous.
    const activeTokens = tokens as Array<
      Token & { lock_verified_at: string | null; lock_unlock_at: string | null }
    >;

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

  const githubTier = calculateTrustTier(token, profile, {
    repoData,
    hasRecentCommits,
    hasPostLaunchCommits,
    isLiveUrlVerified,
    isLockVerified: true,
  });

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // Lock evidence comes from the CANONICAL lock row when one exists (the single
  // authority the reconcile sweep also uses), not the legacy lock_unlock_at.
  // That prevents restoring a high tier onto an already withdrawn/anomalous lock
  // before its cliff (finding 5). Only when no canonical lock row has been
  // backfilled yet do we fall back to lock_unlock_at as a coarse locked/eligible
  // signal, which can never manufacture a withdrawn/anomalous state on its own.
  const { data: lockRow, error: lockError } = await supabase
    .from("locks")
    .select("status, cliff_ts")
    .eq("token_id", token.id)
    .eq("canonical", true)
    .maybeSingle();
  if (lockError) throw new Error(`Lock lookup failed: ${lockError.message}`);

  const lockUnlockAt = (token as Token & { lock_unlock_at: string | null }).lock_unlock_at;
  const lockEvidence = lockRow
    ? {
        status: lockRow.status as LockStatus,
        cliffTs: lockRow.cliff_ts as string,
        lastVerifiedAt: null,
      }
    : lockUnlockAt
      ? {
          status: (nowMs >= new Date(lockUnlockAt).getTime()
            ? "unlock_eligible"
            : "locked") as LockStatus,
          cliffTs: lockUnlockAt,
          lastVerifiedAt: null,
        }
      : null;
  const projection = projectTrust(lockEvidence, { githubTier }, nowMs, nowIso);

  const isChanged = projection.tier !== token.trust_tier;

  // Route the tier write through commit_token_tier, the SINGLE writer of
  // tokens.trust_tier, instead of a direct update here. That keeps this refresh
  // from being a second racing tier writer alongside the lock reconciliation
  // (finding 5). The freshly computed githubTier is persisted as INDEPENDENT
  // evidence in the same call, so the original GitHub tier survives the
  // projection's flooring and is never reconstructed from the floored trust_tier.
  const { error: updateError } = await supabase.rpc("commit_token_tier", {
    p_token_id: token.id,
    p_trust_tier: projection.tier,
    p_github_tier: githubTier,
    p_tier_computed_at: projection.tierComputedAt,
    p_policy_version: TRUST_POLICY_VERSION,
    // The refresh IS the github-evidence writer: persist exactly what it computed,
    // including a cleared null when the repo was unlinked/deleted, rather than
    // coalescing to the stale stored value (finding: github clear).
    p_set_github_tier: true,
  });

  if (updateError) throw new Error(`Tier update failed: ${updateError.message}`);

  return isChanged;
}
