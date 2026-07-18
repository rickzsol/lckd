import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getServerClient } from "@/lib/supabase";
import { getGitHubRepoDetails, getRecentCommits, getCommitCountSinceLaunch } from "@/lib/github/api";
import { calculateTrustTier } from "@/lib/github/tierCalculator";
import { verifyLiveUrl } from "@/lib/github/urlVerifier";
import { triggerTierTransitionAttestation, triggerExpiredLockClose } from "@/lib/sas/lockTrigger";
import { isSasEnabled } from "@/lib/sas/config";
import { POLICY_VERSION, SCHEMA_VERSION } from "@/lib/sas/schema";
import { type TrustTierValue } from "@/lib/sas/schema";
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
  // Downgrade AND advance the durable revocation request nonce in the SAME
  // statement, so the on-chain close can never be lost to a transient failure or an
  // in-flight issuance: the marker (requested_rev > serviced_rev) persists until the
  // close is durably enqueued (or there is provably nothing to revoke). A monotonic
  // rev, not a boolean, so a second expiry arriving while an earlier request is still
  // in flight bumps the rev and forces another close pass rather than being erased by
  // a stale clear. A best-effort close after the commit swallowed failures and
  // permanently missed revocation.
  const { data: downgradedTokens, error: downgradeError } = await supabase.rpc(
    "downgrade_expired_locks",
    { p_now: now.toISOString() },
  );
  if (downgradeError) {
    console.error("[cron] Expired lock downgrade failed:", downgradeError.message);
    return NextResponse.json({ error: "Failed to downgrade expired locks" }, { status: 500 });
  }
  const expiredDowngrades = (downgradedTokens as Array<{ id: string }> | null)?.length ?? 0;

  // Drive the durable close for EVERY token still marked for revocation, not just
  // this pass's downgrades: a prior pass may have set the marker and failed to
  // enqueue (transient error or in-flight issuance). The marker is cleared only on
  // a terminal outcome (enqueued, or provably nothing to revoke); a "retry" leaves
  // it set for the next pass. An expired lock ends the finalized claim, so we CLOSE
  // the on-chain attestation, never reissue (a past-cliff reissue would close the
  // old account and dead-letter the impossible create). (SAS_ENABLED gated,
  // non-blocking on the request path.)
  const revocations = await driveExpiredCloseMarkers(supabase);

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

  const message = `Refreshed ${refreshed} tokens, ${tierChanges} tier changes, ${expiredDowngrades} expired lock downgrades, ${revocations} revocations cleared`;
  console.log(message);
  return NextResponse.json({ message, refreshed, tierChanges, expiredDowngrades, revocations });
}

/**
 * Drive the durable expired-lock close for every token whose revocation request is
 * still pending (requested_rev > serviced_rev), advancing the serviced rev only on a
 * terminal outcome so a transient failure or an in-flight issuance is retried on the
 * next cron pass rather than lost. Bounded per run so it never scans the whole table
 * at once. Returns the number of markers advanced this pass.
 *
 * The observed requested_rev is captured BEFORE driving and passed to the guarded
 * clear: if a newer downgrade bumps requested_rev in the meantime, the clear no-ops
 * and the token stays pending, so a revocation request that arrived during one in
 * flight is never erased.
 */
async function driveExpiredCloseMarkers(
  supabase: ReturnType<typeof getServerClient>,
): Promise<number> {
  const MARKER_BATCH = 200;
  const { data, error } = await supabase.rpc("list_pending_close_markers", {
    p_limit: MARKER_BATCH,
  });
  if (error) {
    console.error("[cron] Expired-close marker fetch failed:", error.message);
    return 0;
  }
  const marked = (data as Array<{ id: string; requested_rev: number }> | null) ?? [];
  let cleared = 0;
  for (const row of marked) {
    const outcome = await triggerExpiredLockClose({ tokenId: row.id });
    if (outcome === "retry") continue;
    // Terminal: the close is durably enqueued or there is nothing to revoke. Advance
    // the serviced rev to the rev we observed at fetch time. The RPC guard rejects the
    // advance if a newer downgrade bumped requested_rev past it, leaving the token
    // pending so the replacement is closed next pass.
    const { data: advanced, error: clearError } = await supabase.rpc(
      "clear_expired_close_marker",
      { p_token_id: row.id, p_serviced_rev: row.requested_rev },
    );
    if (clearError) {
      console.error(`[cron] Failed to clear revocation marker for ${row.id}:`, clearError.message);
      continue;
    }
    if (advanced === true) cleared++;
  }
  return cleared;
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

  // A tier change is an evidence transition, but so is a policy or schema version
  // bump: the on-chain payload embeds policy_version, and the schema PDA pins
  // schema_version, so a live attestation issued under an older version must be
  // reissued even when the tier is unchanged. Reissue when the tier changed OR the
  // live attestation carries a stale version. triggerTierTransitionAttestation
  // re-derives evidence under the CURRENT versions and passes the live
  // attestation's stored policy/schema versions into the trigger, whose
  // short-circuit forces a reissue on a version bump even when the evidence hash is
  // unchanged (schema_version is separate from the hash claim), and no-ops if
  // nothing differs, so an unnecessary call is safe. (SAS_ENABLED gated,
  // non-blocking.) The trust API `anchor` response field that surfaces the
  // resulting descriptor stays a documented TODO(trust-api) seam on
  // feature/trust-api; getTrustAnchorDescriptor is that seam here.
  const needsVersionReissue = isChanged
    ? false
    : await hasStaleAttestationVersion(supabase, token.mint_address);
  if (isChanged || needsVersionReissue) {
    await triggerTierTransitionAttestation({
      tokenId: token.id,
      newTier: newTier as TrustTierValue,
    });
  }

  return isChanged;
}

/**
 * Whether the live attestation for a mint was issued under an older policy or
 * schema version than the current constants. Reads only when SAS is enabled so a
 * disabled deployment pays no extra query per refreshed token.
 */
async function hasStaleAttestationVersion(
  supabase: ReturnType<typeof getServerClient>,
  mint: string,
): Promise<boolean> {
  if (!isSasEnabled()) return false;
  const { data } = await supabase
    .from("attestations")
    .select("policy_version, schema_version")
    .eq("mint", mint)
    .in("status", ["pending", "submitted", "finalized"])
    .order("generation", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return false;
  const row = data as { policy_version: number; schema_version: number };
  return row.policy_version !== POLICY_VERSION || row.schema_version !== SCHEMA_VERSION;
}
