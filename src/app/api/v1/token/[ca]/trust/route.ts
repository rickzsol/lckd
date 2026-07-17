import { type NextRequest } from "next/server";
import { guardPublic, publicJson, publicError, publicOptions, publicMethodNotAllowed, runPublic } from "@/lib/api/publicCors";
import { isValidSolanaAddress, isValidTokenIdentifier } from "@/lib/api/validation";
import { envelope, tokenSource } from "@/lib/api/envelope";
import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";
import { buildLockBlock, tierSlug, type TrustResponseData } from "@/lib/trust/response";
import { TrustTier } from "@/types/index";
import type { LockPublicRow } from "@/types/trust";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return publicOptions();
}

// Explicit non-GET handlers so unsupported methods return a public-CORS 405
// rather than an absent-CORS Next.js default (finding 13).
export const POST = publicMethodNotAllowed;
export const PUT = publicMethodNotAllowed;
export const PATCH = publicMethodNotAllowed;
export const DELETE = publicMethodNotAllowed;

const TOKEN_COLUMNS =
  "id, mint_address, trust_tier, tier_computed_at, github_username, github_repo";
const PROFILE_COLUMNS = "github_username, account_created_at";

/**
 * Public trust snapshot. Failure never masquerades as absence:
 *  - 404 only for a confirmed missing token
 *  - 502 for invalid upstream data
 *  - 503 when the datastore is unavailable
 * A dependency failure is never serialized as "no lock" / "no attestation".
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ca: string }> },
) {
  return runPublic(async () => {
    const { ca } = await params;
    if (!isValidTokenIdentifier(ca)) {
      return publicError("A valid token address or ID is required", 400);
    }

    const limited = await guardPublic(request, "trust_read");
    if (limited) return limited;

    if (!hasSupabaseConfig()) {
      return publicError("Trust data unavailable", 503);
    }

    const supabase = getSupabase();
    const tokenQuery = supabase.from("tokens").select(TOKEN_COLUMNS);
    const { data: token, error: tokenError } = await (isValidSolanaAddress(ca)
      ? tokenQuery.eq("mint_address", ca)
      : tokenQuery.eq("id", ca)
    ).maybeSingle();

    if (tokenError) {
      console.error("[trust] token lookup failed:", tokenError.message);
      return publicError("Trust data unavailable", 503);
    }
    if (!token) return publicError("Token not found", 404);

    const now = Date.now();
    const mint = token.mint_address as string;

    const { data: lockRows, error: lockError } = await supabase
      .from("locks_public")
      .select(
        "id, token_id, mint, stream_program, stream_id, recipient, deposited_amount, withdrawn_amount, total_supply_raw, decimals, lock_bps, cliff_ts, status, canonical, last_verified_at",
      )
      .eq("token_id", token.id)
      .eq("canonical", true)
      .limit(1);

    if (lockError) {
      console.error("[trust] lock lookup failed:", lockError.message);
      return publicError("Trust verification unavailable", 503);
    }

    const canonicalLock = (lockRows as LockPublicRow[] | null)?.[0] ?? null;
    const lock = canonicalLock ? buildLockBlock(canonicalLock, now) : null;

    const github = await loadGithub(supabase, token.github_username, token.github_repo);

    const tierComputedAt = (token.tier_computed_at as string | null) ?? null;
    const data: TrustResponseData = {
      mint,
      tier: tierSlug((token.trust_tier as TrustTier) ?? TrustTier.LOCKED),
      tierComputedAt,
      lock,
      github,
      // Attestation block shape is wired later by the SAS branch; null for now.
      attestation: null,
    };

    // stale reflects real verification freshness, not a hardcoded false: a tier
    // computed long ago or a lock whose on-chain state was last verified beyond
    // the freshness window is served with stale=true so consumers know to treat
    // it with caution (finding 11).
    const stale = isTrustStale(tierComputedAt, canonicalLock?.last_verified_at ?? null, now);

    return publicJson(
      envelope(data, { source: tokenSource(mint), stale }),
      200,
      { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=45" },
    );
  });
}

// Trust data is stale when the projected tier or the lock's finalized
// verification is older than these windows. A missing timestamp is treated as
// stale (never-verified is not fresh).
const TIER_FRESH_MS = 26 * 60 * 60 * 1000; // GitHub cron runs hourly; 26h grace.
const LOCK_FRESH_MS = 48 * 60 * 60 * 1000; // reconcile sweep runs daily; 48h grace.

export function isTrustStale(
  tierComputedAt: string | null,
  lockVerifiedAt: string | null,
  now: number,
): boolean {
  if (isOlderThan(tierComputedAt, TIER_FRESH_MS, now)) return true;
  // A lock block is only present when there is a canonical lock; when present its
  // finalized verification must be within the window.
  if (lockVerifiedAt !== null && isOlderThan(lockVerifiedAt, LOCK_FRESH_MS, now)) {
    return true;
  }
  return false;
}

function isOlderThan(iso: string | null, windowMs: number, now: number): boolean {
  if (!iso) return true;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return true;
  return now - ts > windowMs;
}

async function loadGithub(
  supabase: ReturnType<typeof getSupabase>,
  username: string | null,
  repo: string | null,
): Promise<TrustResponseData["github"]> {
  if (!username) return null;
  const { data, error } = await supabase
    .from("github_profiles")
    .select(PROFILE_COLUMNS)
    .eq("github_username", username)
    .maybeSingle();
  if (error) {
    console.error("[trust] github profile lookup failed:", error.message);
    // Public aggregate the site already shows; a lookup miss is not a hard fail.
    return { username, accountCreatedAt: null, repo };
  }
  return {
    username,
    accountCreatedAt: (data?.account_created_at as string | null) ?? null,
    repo,
  };
}
