import { Connection } from "@solana/web3.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TrustTier } from "@/types/index";
import type { LockRow } from "@/types/trust";
import {
  bindStreamToLock,
  deriveWithdrawalStatus,
  readFinalizedStreamState,
  type LockIdentity,
  type StreamReadResult,
} from "./lockVerification";
import { projectTrust, TRUST_POLICY_VERSION } from "./projection";

/** Injectable finalized reader so the reconciliation logic is testable without a
 * live RPC. Defaults to the real finalized read. */
export type StreamReader = (
  connection: Connection,
  streamId: string,
) => Promise<StreamReadResult>;

/** Inbox lease the webhook consumer holds. When present, the commit is fenced on
 * this lease still being held and the row unprocessed, so a reclaimed-lease worker
 * cannot commit (finding 8). The sweep passes none and commits unfenced. */
export interface InboxLease {
  inboxId: string;
  leaseId: string | null;
}

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
 *  - When invoked from the webhook consumer the commit is fenced on the inbox
 *    lease, so a worker whose lease was reclaimed cannot commit (finding 8).
 *
 * Returns committed=false when the lease fence rejected the write; the caller
 * treats that as a lost lease and does not count the row as reconciled.
 */
export async function reconcileLock(
  supabase: SupabaseClient,
  connection: Connection,
  lock: LockRow,
  now: number,
  signature?: string | null,
  slot?: string | number | null,
  readStream: StreamReader = readFinalizedStreamState,
  lease?: InboxLease | null,
): Promise<{ statusChanged: boolean; tierChanged: boolean; committed: boolean }> {
  const read = await readStream(connection, lock.stream_id);
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
    // not_found / rpc_error: deriveWithdrawalStatus throws on both, so nothing is
    // committed from an absent account or a read failure (finding 2).
    const derived = deriveWithdrawalStatus(storedWithdrawn, read, lock.cliff_ts, now);
    status = derived.status;
    withdrawnAmount = derived.withdrawnAmount;
  }

  const nowIso = new Date(now).toISOString();
  const statusChanged = status !== lock.status || withdrawnAmount !== lock.withdrawn_amount;

  // Only the CANONICAL lock projects the token tier. A noncanonical lock is
  // reconciled for its own status/amount but must not drive tokens.trust_tier
  // (finding 5): passing p_token_id null makes the commit skip the token update
  // entirely, so a secondary lock can never move the tier.
  const projection = lock.canonical
    ? await projectFromCanonicalLock(supabase, lock, status, now, nowIso)
    : null;
  const tierChanged =
    lock.canonical && projection !== null && projection.tier !== projection.previousTier;

  const { data: committed, error } = await supabase.rpc("commit_lock_reconciliation", {
    p_lock_id: lock.id,
    p_token_id: lock.canonical ? lock.token_id : null,
    p_status: status,
    p_withdrawn_amount: withdrawnAmount,
    p_verified_at: nowIso,
    p_verified_signature: signature ?? lock.last_verified_signature,
    p_verified_slot: slot != null ? Number(slot) : lock.last_verified_slot != null ? Number(lock.last_verified_slot) : null,
    p_trust_tier: projection?.tier ?? TrustTier.LOCKED,
    p_policy_version: TRUST_POLICY_VERSION,
    p_inbox_id: lease?.inboxId ?? null,
    p_lease_id: lease?.leaseId ?? null,
  });
  if (error) throw new Error(`reconciliation commit failed: ${error.message}`);

  return { statusChanged, tierChanged, committed: committed !== false };
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
