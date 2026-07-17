import "server-only";

import { getServerClient } from "@/lib/supabase";
import {
  attestationExists,
  buildAttestationContext,
  buildCloseInstruction,
  buildCreateInstruction,
  broadcastPrepared,
  prepareInstructions,
  readLivePayload,
  reconcileSignature,
  SasIssuerError,
  type AttestationContext,
} from "./issuer";
import {
  claimAttestationJob,
  completeAttestationJob,
  completeCloseAttestationJob,
  failAttestationJob,
  finishAttestationJobNoop,
  markBroadcast,
  type OutboxJob,
} from "./outbox";
import { decideIssuance } from "./issuer";
import { hashEvidence, type TrustEvidence } from "./evidence";
import { SCHEMA_VERSION, type TrustTierValue } from "./schema";

/**
 * Outbox worker: claims one leased job and drives it to a finalized on-chain
 * effect, mirroring the repo's Robinhood recovery doctrine. The signature is
 * persisted BEFORE broadcast; an ambiguous outcome reconciles from chain by the
 * persisted signature. On-chain effects cannot be committed transactionally with
 * Postgres, so the outbox is the bridge.
 *
 * The worker NEVER blindly follows the stored operation. It reads live chain
 * state first and decides the real work from the full desired payload + expiry,
 * so `issue` with a matching PDA, `reissue` after an external close, and `close`
 * when already absent all resolve without a simulation-fail dead-letter.
 *
 * Reissue is TWO durable phases: a close phase (its own persisted close signature
 * and reconciliation) followed by a create phase (its own persisted signature and
 * completion). A single close+create transaction was deliberately avoided: an
 * ambiguous send cannot be reconciled by a single signature.
 */

export interface WorkerResult {
  claimed: number;
  completed: number;
  reconciled: number;
  skipped: number;
  failed: number;
  deadLettered: number;
}

/**
 * Reconstruct server-derived trust evidence for a job. The desired payload
 * (tier, lock_bps, cliff_ts, policy_version) was derived by the trust projection
 * at enqueue time; the identity fields (creator, stream_id, github) come from the
 * finalized token record. NO caller input is involved.
 *
 * TODO(trust-api): when feature/trust-api lands, source these identity fields and
 * finalized supply from the trust projection's canonical lock record instead of
 * the tokens table, so evidence assembly reads a single authority.
 */
async function evidenceForJob(job: OutboxJob): Promise<TrustEvidence> {
  const { data, error } = await getServerClient()
    .from("tokens")
    .select("mint_address, creator_wallet, lock_metadata_id, github_username")
    .eq("id", job.token_id)
    .maybeSingle();
  if (error) throw new SasIssuerError(`Token lookup failed: ${error.message}`);
  if (!data) throw new SasIssuerError("Token record missing for attestation job", false);

  const token = data as {
    mint_address: string;
    creator_wallet: string;
    lock_metadata_id: string | null;
    github_username: string | null;
  };

  if (!token.lock_metadata_id) {
    throw new SasIssuerError("Token has no Streamflow stream account to attest", false);
  }

  // The desired snapshot already carries the projection-computed lock_bps, so we
  // reconstruct evidence directly rather than recomputing bps here. streamId is
  // the Streamflow metadata/stream account persisted at lock verification. Both
  // policy AND schema versions come from the job snapshot, never a live constant,
  // so a deployment between enqueue and processing cannot skew the record.
  const evidence: TrustEvidence = {
    mint: token.mint_address,
    creator: token.creator_wallet,
    streamId: token.lock_metadata_id,
    tier: job.desired_tier as TrustTierValue,
    lockBps: job.desired_lock_bps,
    cliffTs: BigInt(job.desired_cliff_ts),
    github: token.github_username ?? "",
    policyVersion: job.desired_policy_version,
    schemaVersion: job.desired_schema_version ?? SCHEMA_VERSION,
  };

  // Guard: the evidence hash must match what was enqueued, or the underlying
  // facts drifted and this job's snapshot is stale.
  if (hashEvidence(evidence) !== job.evidence_hash) {
    throw new SasIssuerError("Evidence drifted from the enqueued snapshot", false);
  }
  return evidence;
}

function expiryIso(cliffTs: bigint): string {
  return new Date(Number(cliffTs) * 1000).toISOString();
}

/**
 * Reconcile a job that already persisted a signature before an ambiguous send.
 * Runs whenever pending_signature exists, regardless of the claimed-from status.
 * A confirmed-or-finalized signature means the on-chain effect landed, so we
 * complete/close from the persisted signature instead of resending. A failed or
 * never-landed signature returns "reprocess" so the caller re-drives with a fresh
 * blockhash.
 */
async function reconcilePendingJob(
  ctx: AttestationContext,
  job: OutboxJob,
): Promise<"reconciled" | "reprocess"> {
  const signature = job.pending_signature;
  if (!signature) return "reprocess";
  const state = await reconcileSignature(ctx, signature);
  if (state !== "confirmed" && state !== "finalized") {
    // Failed or never landed: re-drive with a fresh blockhash.
    return "reprocess";
  }

  // The landed transaction is the CREATE half (issue/reissue) or a pure close.
  if (job.operation === "close") {
    const pda = (await buildCloseInstruction(ctx, job.mint)).attestationPda;
    await completeCloseAttestationJob({
      id: job.id,
      leaseToken: job.lease_token as string,
      cluster: job.cluster,
      mint: job.mint,
      schemaVersion: job.desired_schema_version ?? SCHEMA_VERSION,
      attestationPda: pda.toString(),
      closeSignature: signature,
    });
    return "reconciled";
  }

  const evidence = await evidenceForJob(job);
  const { attestationPda } = await buildCreateInstruction(ctx, evidence);
  await completeAttestationJob({
    id: job.id,
    leaseToken: job.lease_token as string,
    tokenId: job.token_id,
    cluster: job.cluster,
    mint: job.mint,
    attestationPda: attestationPda.toString(),
    tier: evidence.tier,
    policyVersion: evidence.policyVersion,
    schemaVersion: evidence.schemaVersion,
    lockBps: evidence.lockBps,
    cliffTs: evidence.cliffTs,
    evidenceHash: job.evidence_hash,
    expiryTs: expiryIso(evidence.cliffTs),
    txSignature: signature,
    closeSignature: job.pending_close_signature,
  });
  return "reconciled";
}

/**
 * Broadcast a single-instruction transaction with the persist-before-broadcast
 * fence. The signature is persisted first (as pending_signature or, for a close
 * phase, pending_close_signature). markBroadcast MUST return true; a false result
 * means the lease was lost and we abort WITHOUT broadcasting so a stale worker
 * never lands an effect it can no longer commit.
 */
async function broadcastFenced(
  ctx: AttestationContext,
  job: OutboxJob,
  instruction: Awaited<ReturnType<typeof buildCreateInstruction>>["instruction"],
  isClosePhase: boolean,
): Promise<string> {
  const { signature, signed } = await prepareInstructions(ctx, [instruction]);
  const persisted = isClosePhase
    ? await markBroadcast(job.id, job.lease_token as string, signature, signature)
    : await markBroadcast(job.id, job.lease_token as string, signature, job.pending_close_signature);
  if (!persisted) {
    throw new SasIssuerError("Lost lease before broadcast; aborting", false);
  }
  await broadcastPrepared(ctx, signed);
  return signature;
}

type ProcessOutcome = "completed" | "reconciled" | "skipped";

async function processJob(
  ctx: AttestationContext,
  job: OutboxJob,
  claimedFromStatus: string,
): Promise<ProcessOutcome> {
  // Any job carrying a persisted signature is reconciled from chain first,
  // regardless of the status it was claimed from. Only reprocess when the
  // signature did not land.
  if (job.pending_signature) {
    const outcome = await reconcilePendingJob(ctx, job);
    if (outcome === "reconciled") return "reconciled";
  }
  void claimedFromStatus;

  const evidence = await evidenceForJob(job);

  // Decide from LIVE chain state, never blindly from the stored operation.
  if (job.operation === "close") {
    return processClose(ctx, job);
  }

  const live = await readLivePayload(ctx, job.mint);
  const decision = decideIssuance(live, evidence);

  if (decision === "skip") {
    // Live PDA already matches the desired claim: no on-chain effect, no fake
    // signature. Mark the outbox done without inserting a generation.
    const pda = (await buildCreateInstruction(ctx, evidence)).attestationPda;
    await finishAttestationJobNoop({
      id: job.id,
      leaseToken: job.lease_token as string,
      cluster: job.cluster,
      mint: job.mint,
      schemaVersion: evidence.schemaVersion,
      attestationPda: pda.toString(),
      closeLive: false,
    });
    return "skipped";
  }

  if (decision === "reissue") {
    // Phase 1: close the stale account if it still exists, as its own durable
    // broadcast with its own persisted signature and reconciliation.
    if (await attestationExists(ctx, job.mint)) {
      const { instruction } = await buildCloseInstruction(ctx, job.mint);
      await broadcastFenced(ctx, job, instruction, true);
      // Clear the phase-1 signatures; the create phase persists its own.
      job.pending_close_signature = null;
      job.pending_signature = null;
    }
    // Phase 2: create fresh.
    return processCreate(ctx, job, evidence, null);
  }

  // Fresh issue.
  return processCreate(ctx, job, evidence, null);
}

/** Drive a pure close: broadcast the close, then complete without inserting any
 * generation. An already-absent account short-circuits to a no-op finish. */
async function processClose(ctx: AttestationContext, job: OutboxJob): Promise<ProcessOutcome> {
  const pda = (await buildCloseInstruction(ctx, job.mint)).attestationPda;
  if (!(await attestationExists(ctx, job.mint))) {
    // Already absent (external or prior close): nothing to broadcast. Close any
    // live DB row and finish without recording a signature.
    await finishAttestationJobNoop({
      id: job.id,
      leaseToken: job.lease_token as string,
      cluster: job.cluster,
      mint: job.mint,
      schemaVersion: job.desired_schema_version ?? SCHEMA_VERSION,
      attestationPda: pda.toString(),
      closeLive: true,
    });
    return "skipped";
  }
  const { instruction } = await buildCloseInstruction(ctx, job.mint);
  const signature = await broadcastFenced(ctx, job, instruction, true);
  await completeCloseAttestationJob({
    id: job.id,
    leaseToken: job.lease_token as string,
    cluster: job.cluster,
    mint: job.mint,
    schemaVersion: job.desired_schema_version ?? SCHEMA_VERSION,
    attestationPda: pda.toString(),
    closeSignature: signature,
  });
  return "completed";
}

/** Broadcast a create instruction with the fence, then finalize the generation. */
async function processCreate(
  ctx: AttestationContext,
  job: OutboxJob,
  evidence: TrustEvidence,
  closeSignature: string | null,
): Promise<ProcessOutcome> {
  const { instruction, attestationPda } = await buildCreateInstruction(ctx, evidence);
  const signature = await broadcastFenced(ctx, job, instruction, false);
  await completeAttestationJob({
    id: job.id,
    leaseToken: job.lease_token as string,
    tokenId: job.token_id,
    cluster: job.cluster,
    mint: job.mint,
    attestationPda: attestationPda.toString(),
    tier: evidence.tier,
    policyVersion: evidence.policyVersion,
    schemaVersion: evidence.schemaVersion,
    lockBps: evidence.lockBps,
    cliffTs: evidence.cliffTs,
    evidenceHash: job.evidence_hash,
    expiryTs: expiryIso(evidence.cliffTs),
    txSignature: signature,
    closeSignature,
  });
  return "completed";
}

/** Process up to `maxJobs` claimed outbox jobs. Each failure is isolated. */
export async function runOutboxWorker(maxJobs = 5): Promise<WorkerResult> {
  const result: WorkerResult = {
    claimed: 0,
    completed: 0,
    reconciled: 0,
    skipped: 0,
    failed: 0,
    deadLettered: 0,
  };
  const ctx = await buildAttestationContext();

  for (let i = 0; i < maxJobs; i++) {
    const claimed = await claimAttestationJob();
    if (!claimed) break;
    const { job, claimedFromStatus } = claimed;
    result.claimed++;
    try {
      const outcome = await processJob(ctx, job, claimedFromStatus);
      if (outcome === "reconciled") result.reconciled++;
      else if (outcome === "skipped") result.skipped++;
      else result.completed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown worker error";
      const permanent = error instanceof SasIssuerError && !error.retryable;
      const failOutcome = await failAttestationJob(
        job.id,
        job.lease_token as string,
        message,
        permanent,
      );
      if (failOutcome === "dead") result.deadLettered++;
      else result.failed++;
    }
  }

  return result;
}
