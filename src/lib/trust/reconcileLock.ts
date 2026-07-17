import { Connection } from "@solana/web3.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TrustTier } from "@/types/index";
import type { LockRow } from "@/types/trust";
import {
  bindStreamToLock,
  deriveWithdrawalStatus,
  readFinalizedStreamState,
  StreamUnavailableError,
  type LockIdentity,
} from "./lockVerification";
import { projectTrust, TRUST_POLICY_VERSION } from "./projection";

/**
 * Verifies one lock against finalized chain state and commits the new lock
 * status + re-projected token tier atomically.
 *
 * Invariants enforced here:
 *  - The decoded stream is BOUND to the stored lock identity + cliff schedule
 *    before any state change; a mismatch is recorded as anomalous, never trusted
 *    as evidence for a lock it does not lock (finding 3).
 *  - A finalized read failure or unconfirmed absence aborts without mutating the
 *    lock (finding 2): StreamUnavailableError propagates so the caller retries.
 *  - Tier projects ONLY from the canonical lock + the persisted github_tier
 *    evidence, never from the already-projected trust_tier (finding 5).
 *  - Lock status/amount and token tier are written in ONE definer RPC, so the
 *    two authorities can never diverge (finding 5).
 */
export async function reconcileLock(
  supabase: SupabaseClient,
  connection: Connection,
  lock: LockRow,
  now: number,
  signature?: string | null,
  slot?: string | number | null,
): Promise<{ statusChanged: boolean; tierChanged: boolean }> {
  const read = await readFinalizedStreamState(connection, lock.stream_id);
  const storedWithdrawn = BigInt(lock.withdrawn_amount);

  let status: LockRow["status"];
  let withdrawnAmount: string;

  if (read.kind === "ok") {
    const mismatch = bindStreamToLock(read.stream, identityFromLock(lock));
    if (mismatch) {
      // The stream does not match the lock it is claimed to lock. Record the
      // observed withdrawn amount and flag anomalous; never mark it verified-good.
      status = "anomalous";
      withdrawnAmount = read.stream.withdrawnAmount.toString();
    } else {
      const derived = deriveWithdrawalStatus(storedWithdrawn, read, lock.cliff_ts, now);
      status = derived.status;
      withdrawnAmount = derived.withdrawnAmount;
    }
  } else {
    // closed / not_found / rpc_error: deriveWithdrawalStatus throws on the two
    // non-committable outcomes and returns a status for a confirmed closure.
    const derived = deriveWithdrawalStatus(storedWithdrawn, read, lock.cliff_ts, now);
    status = derived.status;
    withdrawnAmount = derived.withdrawnAmount;
  }

  const nowIso = new Date(now).toISOString();
  const statusChanged = status !== lock.status || withdrawnAmount !== lock.withdrawn_amount;

  const projection = await projectFromCanonicalLock(supabase, lock, status, now, nowIso);
  const tierChanged = projection !== null && projection.tier !== projection.previousTier;

  const { error } = await supabase.rpc("commit_lock_reconciliation", {
    p_lock_id: lock.id,
    p_token_id: lock.token_id,
    p_status: status,
    p_withdrawn_amount: withdrawnAmount,
    p_verified_at: nowIso,
    p_verified_signature: signature ?? lock.last_verified_signature,
    p_verified_slot: slot != null ? Number(slot) : lock.last_verified_slot != null ? Number(lock.last_verified_slot) : null,
    p_trust_tier: projection?.tier ?? TrustTier.LOCKED,
    p_policy_version: TRUST_POLICY_VERSION,
  });
  if (error) throw new Error(`reconciliation commit failed: ${error.message}`);

  return { statusChanged, tierChanged };
}

function identityFromLock(lock: LockRow): LockIdentity {
  return {
    streamProgram: lock.stream_program,
    mint: lock.mint,
    recipient: lock.recipient,
    escrowAta: lock.escrow_ata,
    depositedAmount: lock.deposited_amount,
    cliffTsRaw: lock.cliff_ts_raw,
  };
}

interface ProjectionOutcome {
  tier: TrustTier;
  previousTier: TrustTier;
}

/**
 * Projects the token tier from the freshly verified lock status + the persisted
 * github_tier evidence. github_tier is stored independently of trust_tier so the
 * original GitHub tier survives a flooring; we never read trust_tier back as
 * evidence (finding 5). Returns null when the token row is gone.
 */
async function projectFromCanonicalLock(
  supabase: SupabaseClient,
  lock: LockRow,
  lockStatus: LockRow["status"],
  now: number,
  nowIso: string,
): Promise<ProjectionOutcome | null> {
  const { data: token, error } = await supabase
    .from("tokens")
    .select("trust_tier, github_tier")
    .eq("id", lock.token_id)
    .maybeSingle();
  if (error) throw new Error(`token lookup failed: ${error.message}`);
  if (!token) return null;

  const previousTier = (token.trust_tier as TrustTier) ?? TrustTier.LOCKED;
  const githubTier = (token.github_tier as TrustTier | null) ?? previousTier;

  const projection = projectTrust(
    { status: lockStatus, cliffTs: lock.cliff_ts, lastVerifiedAt: nowIso },
    { githubTier },
    now,
    nowIso,
  );
  return { tier: projection.tier, previousTier };
}
