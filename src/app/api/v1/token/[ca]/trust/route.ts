import { type NextRequest } from "next/server";
import { guardPublic, publicJson, publicError, publicOptions, publicMethodNotAllowed, runPublic } from "@/lib/api/publicCors";
import { isValidSolanaAddress, isValidTokenIdentifier } from "@/lib/api/validation";
import { envelope, tokenSource } from "@/lib/api/envelope";
import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";
import { buildLockBlock, tierSlug, type TrustResponseData } from "@/lib/trust/response";
import { isTrustStale } from "@/lib/trust/staleness";
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

    // Backfill gating: the public view returns nothing until the staged backfill
    // completes. Without this check an incomplete backfill would surface as
    // lock:null, misreporting an unverified token as unlocked. When backfill is
    // incomplete we withhold the whole snapshot with an explicit 503 instead
    // (finding 10).
    const backfillComplete = await isBackfillComplete(supabase);
    if (backfillComplete === null) {
      return publicError("Trust verification unavailable", 503);
    }
    if (!backfillComplete) {
      return publicError("Trust verification is backfilling; try again shortly", 503);
    }

    // Filter by the public `mint`, not an internal id: the view no longer exposes
    // id/token_id (finding 12). mint is unique per token.
    const { data: lockRows, error: lockError } = await supabase
      .from("locks_public")
      .select(
        "mint, stream_program, stream_id, deposited_amount, withdrawn_amount, total_supply_raw, decimals, lock_bps, cliff_ts, status, canonical, last_verified_at, token_name, token_ticker, token_image_uri, token_trust_tier",
      )
      .eq("mint", mint)
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
    // computed long ago, a lock whose on-chain state was last verified beyond the
    // freshness window, a canonical lock never yet verified (last_verified_at
    // null), or a degraded GitHub lookup are all served with stale=true so
    // consumers know to treat it with caution (finding 11).
    const stale =
      isTrustStale(tierComputedAt, canonicalLock !== null, canonicalLock?.last_verified_at ?? null, now) ||
      github?.degraded === true;

    return publicJson(
      envelope(data, { source: tokenSource(mint), stale }),
      200,
      { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=45" },
    );
  });
}

/**
 * Reads the trust_kv backfill gate. Returns true/false for a confirmed state, or
 * null when the read itself failed (so the caller returns 503 rather than
 * guessing). The public view is empty until this flips to 'true'; the route must
 * distinguish "incomplete backfill" from "no lock" and withhold (finding 10).
 */
async function isBackfillComplete(
  supabase: ReturnType<typeof getSupabase>,
): Promise<boolean | null> {
  // trust_kv is RLS-locked with no anon grant; read the gate through the
  // anon-callable definer function, which exposes only the boolean.
  const { data, error } = await supabase.rpc("is_backfill_complete");
  if (error) {
    console.error("[trust] backfill gate lookup failed:", error.message);
    return null;
  }
  return data === true;
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
    // A lookup failure is surfaced as degraded, not serialized as a confirmed
    // missing account-created date (finding 11). The tier itself is unaffected.
    return { username, accountCreatedAt: null, repo, degraded: true };
  }
  return {
    username,
    accountCreatedAt: (data?.account_created_at as string | null) ?? null,
    repo,
    degraded: false,
  };
}
