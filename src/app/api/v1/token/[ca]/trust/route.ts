import { type NextRequest } from "next/server";
import { guardPublic, publicJson, publicError, publicOptions, runPublic } from "@/lib/api/publicCors";
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

    const data: TrustResponseData = {
      mint,
      tier: tierSlug((token.trust_tier as TrustTier) ?? TrustTier.LOCKED),
      tierComputedAt: (token.tier_computed_at as string | null) ?? null,
      lock,
      github,
      // Attestation block shape is wired later by the SAS branch; null for now.
      attestation: null,
    };

    return publicJson(
      envelope(data, { source: tokenSource(mint), stale: false }),
      200,
      { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=45" },
    );
  });
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
