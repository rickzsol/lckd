import "server-only";

import { getServerClient } from "@/lib/supabase";

/**
 * Durable outbox access layer for SAS issuance. All state transitions go through
 * security-definer RPCs so leasing, backoff, and dead-lettering are atomic and
 * concurrent workers never double-issue. No caller input flows into the desired
 * payload: the trust projection derives it server-side before enqueue.
 */

export type OutboxOperation = "issue" | "reissue" | "close";

export interface OutboxJob {
  id: string;
  token_id: string;
  attestation_id: string | null;
  cluster: string;
  mint: string;
  operation: OutboxOperation;
  desired_tier: number;
  desired_lock_bps: number;
  desired_cliff_ts: number;
  desired_policy_version: number;
  desired_schema_version: number;
  evidence_hash: string;
  status: string;
  attempts: number;
  max_attempts: number;
  lease_token: string | null;
  pending_signature: string | null;
  pending_close_signature: string | null;
}

/** A claimed job plus the status it was claimed FROM, so a prior broadcast is
 * reconciled against its persisted signature rather than blindly resent. */
export interface ClaimedJob {
  job: OutboxJob;
  claimedFromStatus: string;
}

export interface EnqueueInput {
  tokenId: string;
  cluster: string;
  mint: string;
  operation: OutboxOperation;
  tier: number;
  lockBps: number;
  cliffTs: bigint;
  policyVersion: number;
  schemaVersion: number;
  evidenceHash: string;
}

export class OutboxError extends Error {}

function fail(message: string): never {
  throw new OutboxError(message);
}

export async function enqueueAttestationJob(input: EnqueueInput): Promise<string> {
  const { data, error } = await getServerClient().rpc("enqueue_attestation_job", {
    p_token_id: input.tokenId,
    p_cluster: input.cluster,
    p_mint: input.mint,
    p_operation: input.operation,
    p_tier: input.tier,
    p_lock_bps: input.lockBps,
    p_cliff_ts: input.cliffTs.toString(),
    p_policy_version: input.policyVersion,
    p_schema_version: input.schemaVersion,
    p_evidence_hash: input.evidenceHash,
  });
  if (error) fail(`Failed to enqueue attestation job: ${error.message}`);
  return data as string;
}

export async function claimAttestationJob(leaseSeconds = 120): Promise<ClaimedJob | null> {
  const { data, error } = await getServerClient().rpc("claim_attestation_job", {
    p_lease_seconds: leaseSeconds,
  });
  if (error) fail(`Failed to claim attestation job: ${error.message}`);
  const rows = data as Array<{ job: OutboxJob; claimed_from_status: string }> | null;
  if (!rows || rows.length === 0) return null;
  return { job: rows[0].job, claimedFromStatus: rows[0].claimed_from_status };
}

export async function markBroadcast(
  id: string,
  leaseToken: string,
  signature: string,
  closeSignature: string | null,
  leaseSeconds = 120,
): Promise<boolean> {
  const { data, error } = await getServerClient().rpc("mark_attestation_broadcast", {
    p_id: id,
    p_lease_token: leaseToken,
    p_signature: signature,
    p_close_signature: closeSignature,
    p_lease_seconds: leaseSeconds,
  });
  if (error) fail(`Failed to mark broadcast: ${error.message}`);
  return data === true;
}

/** Persist a reissue close-phase signature before its broadcast: sets only
 * pending_close_signature, leaving pending_signature null. Returns false if the
 * lease was lost. */
export async function markCloseBroadcast(
  id: string,
  leaseToken: string,
  closeSignature: string,
  leaseSeconds = 120,
): Promise<boolean> {
  const { data, error } = await getServerClient().rpc("mark_attestation_close_broadcast", {
    p_id: id,
    p_lease_token: leaseToken,
    p_close_signature: closeSignature,
    p_lease_seconds: leaseSeconds,
  });
  if (error) fail(`Failed to mark close broadcast: ${error.message}`);
  return data === true;
}

export interface AdvanceReissueInput {
  id: string;
  leaseToken: string;
  cluster: string;
  mint: string;
  schemaVersion: number;
  attestationPda: string;
  closeSignature: string;
}

/** Complete the reissue close phase and flip the job to its create phase. */
export async function advanceReissueToCreate(input: AdvanceReissueInput): Promise<void> {
  const { error } = await getServerClient().rpc("advance_reissue_to_create", {
    p_id: input.id,
    p_lease_token: input.leaseToken,
    p_cluster: input.cluster,
    p_mint: input.mint,
    p_schema_version: input.schemaVersion,
    p_attestation_pda: input.attestationPda,
    p_close_signature: input.closeSignature,
  });
  if (error) fail(`Failed to advance reissue to create: ${error.message}`);
}

export interface CompleteInput {
  id: string;
  leaseToken: string;
  tokenId: string;
  cluster: string;
  mint: string;
  attestationPda: string;
  tier: number;
  /** Policy version from the job snapshot, NOT a deployment-time constant. */
  policyVersion: number;
  /** Schema version from the job snapshot, NOT a deployment-time constant. */
  schemaVersion: number;
  lockBps: number;
  cliffTs: bigint;
  evidenceHash: string;
  expiryTs: string;
  txSignature: string;
  closeSignature: string | null;
}

export async function completeAttestationJob(input: CompleteInput): Promise<string> {
  const { data, error } = await getServerClient().rpc("complete_attestation_job", {
    p_id: input.id,
    p_lease_token: input.leaseToken,
    p_token_id: input.tokenId,
    p_cluster: input.cluster,
    p_mint: input.mint,
    p_attestation_pda: input.attestationPda,
    p_tier: input.tier,
    p_policy_version: input.policyVersion,
    p_schema_version: input.schemaVersion,
    p_lock_bps: input.lockBps,
    p_cliff_ts: input.cliffTs.toString(),
    p_evidence_hash: input.evidenceHash,
    p_expiry_ts: input.expiryTs,
    p_tx_signature: input.txSignature,
    p_close_signature: input.closeSignature,
  });
  if (error) fail(`Failed to complete attestation job: ${error.message}`);
  return data as string;
}

export interface CompleteCloseInput {
  id: string;
  leaseToken: string;
  cluster: string;
  mint: string;
  schemaVersion: number;
  attestationPda: string;
  closeSignature: string;
}

/** Complete a pure close: close the active DB row, mark the outbox done, and
 * never insert a generation (no account exists on chain to record). */
export async function completeCloseAttestationJob(input: CompleteCloseInput): Promise<void> {
  const { error } = await getServerClient().rpc("complete_close_attestation_job", {
    p_id: input.id,
    p_lease_token: input.leaseToken,
    p_cluster: input.cluster,
    p_mint: input.mint,
    p_schema_version: input.schemaVersion,
    p_attestation_pda: input.attestationPda,
    p_close_signature: input.closeSignature,
  });
  if (error) fail(`Failed to complete close attestation job: ${error.message}`);
}

export interface FinishNoopInput {
  id: string;
  leaseToken: string;
  cluster: string;
  mint: string;
  schemaVersion: number;
  attestationPda: string;
  /** Close any live DB rows for the slot (used by the absent-close path). */
  closeLive: boolean;
}

/** Finish a job that needed no on-chain effect: an idempotent skip or a close of
 * an already-absent account. Records no signature and inserts no generation. */
export async function finishAttestationJobNoop(input: FinishNoopInput): Promise<void> {
  const { error } = await getServerClient().rpc("finish_attestation_job_noop", {
    p_id: input.id,
    p_lease_token: input.leaseToken,
    p_cluster: input.cluster,
    p_mint: input.mint,
    p_schema_version: input.schemaVersion,
    p_attestation_pda: input.attestationPda,
    p_close_live: input.closeLive,
  });
  if (error) fail(`Failed to finish attestation job: ${error.message}`);
}

export type FailOutcome = "failed" | "dead" | "not_leased";

export async function failAttestationJob(
  id: string,
  leaseToken: string,
  errorMessage: string,
  permanent = false,
): Promise<FailOutcome> {
  const { data, error } = await getServerClient().rpc("fail_attestation_job", {
    p_id: id,
    p_lease_token: leaseToken,
    p_error: errorMessage.slice(0, 500),
    p_permanent: permanent,
  });
  if (error) fail(`Failed to fail attestation job: ${error.message}`);
  return data as FailOutcome;
}

/**
 * Back off a broadcast job that landed but has not yet finalized. Unlike
 * failAttestationJob this KEEPS the row in 'broadcast' with both pending
 * signatures intact and does not increment attempts, so the finalized-
 * reconciliation path (which requires status='broadcast') still applies on the
 * next claim. Returns false if the lease was lost (a stale worker no-ops).
 */
export async function backoffBroadcastJob(
  id: string,
  leaseToken: string,
  backoffSeconds = 5,
): Promise<boolean> {
  const { data, error } = await getServerClient().rpc("backoff_attestation_broadcast", {
    p_id: id,
    p_lease_token: leaseToken,
    p_backoff_seconds: backoffSeconds,
  });
  if (error) fail(`Failed to back off broadcast job: ${error.message}`);
  return data === true;
}

export async function expireAttestations(limit = 500): Promise<number> {
  const { data, error } = await getServerClient().rpc("expire_attestations", {
    p_limit: limit,
  });
  if (error) fail(`Failed to expire attestations: ${error.message}`);
  return Number(data ?? 0);
}
