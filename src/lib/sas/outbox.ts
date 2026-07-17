import "server-only";

import { getServerClient } from "@/lib/supabase";
import { POLICY_VERSION, SCHEMA_VERSION } from "./schema";

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
  evidence_hash: string;
  status: string;
  attempts: number;
  max_attempts: number;
  lease_token: string | null;
  pending_signature: string | null;
  pending_close_signature: string | null;
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
    p_evidence_hash: input.evidenceHash,
  });
  if (error) fail(`Failed to enqueue attestation job: ${error.message}`);
  return data as string;
}

export async function claimAttestationJob(leaseSeconds = 120): Promise<OutboxJob | null> {
  const { data, error } = await getServerClient().rpc("claim_attestation_job", {
    p_lease_seconds: leaseSeconds,
  });
  if (error) fail(`Failed to claim attestation job: ${error.message}`);
  const rows = data as OutboxJob[] | null;
  return rows && rows.length > 0 ? rows[0] : null;
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

export interface CompleteInput {
  id: string;
  leaseToken: string;
  tokenId: string;
  cluster: string;
  mint: string;
  attestationPda: string;
  tier: number;
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
    p_policy_version: POLICY_VERSION,
    p_schema_version: SCHEMA_VERSION,
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

export async function expireAttestations(limit = 500): Promise<number> {
  const { data, error } = await getServerClient().rpc("expire_attestations", {
    p_limit: limit,
  });
  if (error) fail(`Failed to expire attestations: ${error.message}`);
  return Number(data ?? 0);
}
