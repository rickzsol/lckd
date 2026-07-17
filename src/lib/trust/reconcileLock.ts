import { Connection } from "@solana/web3.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TrustTier } from "@/types/index";
import type { LockRow } from "@/types/trust";
import { deriveWithdrawalStatus, readFinalizedStreamState } from "./lockVerification";
import { projectTrust, TRUST_POLICY_VERSION } from "./projection";

/**
 * Verifies one lock against finalized chain state, updates the lock row, and
 * re-projects the token tier from the new lock evidence + persisted GitHub tier.
 * This is the single write path that mutates `locks.status` and `tokens.trust_tier`
 * together, so no third authority (wall-clock downgrade) can diverge.
 */
export async function reconcileLock(
  supabase: SupabaseClient,
  connection: Connection,
  lock: LockRow,
  now: number,
  signature?: string,
  slot?: number | null,
): Promise<{ statusChanged: boolean; tierChanged: boolean }> {
  const onchain = await readFinalizedStreamState(connection, lock.stream_id);
  const storedWithdrawn = BigInt(lock.withdrawn_amount);
  const result = deriveWithdrawalStatus(storedWithdrawn, onchain, lock.cliff_ts, now);
  const nowIso = new Date(now).toISOString();

  const statusChanged = result.status !== lock.status
    || result.withdrawnAmount !== lock.withdrawn_amount;

  const { error: lockError } = await supabase
    .from("locks")
    .update({
      status: result.status,
      withdrawn_amount: result.withdrawnAmount,
      last_verified_at: nowIso,
      last_verified_signature: signature ?? lock.last_verified_signature,
      last_verified_slot: slot ?? lock.last_verified_slot,
    })
    .eq("id", lock.id);
  if (lockError) throw new Error(`lock update failed: ${lockError.message}`);

  const tierChanged = await reprojectTier(supabase, lock.token_id, result.status, lock.cliff_ts, now, nowIso);
  return { statusChanged, tierChanged };
}

/**
 * Re-derives and persists tier from the freshly verified lock. Only the
 * canonical lock drives tier; the GitHub tier is the persisted `trust_tier`
 * when the lock is holding, floored to LOCKED otherwise.
 */
async function reprojectTier(
  supabase: SupabaseClient,
  tokenId: string,
  lockStatus: LockRow["status"],
  cliffTs: string,
  now: number,
  nowIso: string,
): Promise<boolean> {
  const { data: token, error } = await supabase
    .from("tokens")
    .select("trust_tier")
    .eq("id", tokenId)
    .maybeSingle();
  if (error) throw new Error(`token lookup failed: ${error.message}`);
  if (!token) return false;

  const currentTier = (token.trust_tier as TrustTier) ?? TrustTier.LOCKED;
  const projection = projectTrust(
    { status: lockStatus, cliffTs, lastVerifiedAt: nowIso },
    { githubTier: currentTier },
    now,
    nowIso,
  );

  if (projection.tier === currentTier) {
    // Still record policy/timestamp so the projection stays authoritative.
    await supabase
      .from("tokens")
      .update({ tier_computed_at: nowIso, policy_version: TRUST_POLICY_VERSION })
      .eq("id", tokenId);
    return false;
  }

  const { error: updateError } = await supabase
    .from("tokens")
    .update({
      trust_tier: projection.tier,
      tier_computed_at: nowIso,
      policy_version: TRUST_POLICY_VERSION,
    })
    .eq("id", tokenId);
  if (updateError) throw new Error(`tier update failed: ${updateError.message}`);
  return true;
}
