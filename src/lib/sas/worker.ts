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
  type SignatureState,
} from "./issuer";
import {
  advanceReissueToCreate,
  backoffBroadcastJob,
  claimAttestationJob,
  completeAttestationJob,
  completeCloseAttestationJob,
  failAttestationJob,
  finishAttestationJobNoop,
  markBroadcast,
  markCloseBroadcast,
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
 *
 * A persisted signature is treated as landed ONLY at FINALIZED commitment. A
 * confirmed-but-not-finalized signature waits (backs off and re-reconciles the same
 * signature) rather than advancing or re-driving, so a fork rollback can never leave
 * a recorded generation or an advanced reissue phase on a reverted transaction.
 */

export interface WorkerResult {
  claimed: number;
  completed: number;
  reconciled: number;
  /** Reissue close phase done; the create phase runs on a later claim. */
  advanced: number;
  skipped: number;
  /** Signature landed but not yet finalized; backed off to reconcile later. */
  waiting: number;
  failed: number;
  deadLettered: number;
}

/**
 * A persisted signature counts as LANDED only at FINALIZED commitment. A merely
 * 'confirmed' signature is not yet irreversible, so treating it as landed would
 * record a generation / advance the reissue create phase on a transaction that a
 * fork could still roll back. Anything short of finalized keeps waiting: the job
 * stays in flight and reconciles again on a later claim.
 */
export function signatureHasLanded(state: SignatureState): boolean {
  return state === "finalized";
}

/**
 * How a persisted signature's on-chain state maps to the reconcile decision:
 *   * finalized -> "land":     irreversible; record/advance from it.
 *   * confirmed -> "wait":     landed but not final; back off and re-reconcile the
 *                              SAME signature later. NEVER re-drive (that resends a
 *                              landed effect and can double-issue / double-close).
 *   * failed / unknown -> "reprocess": never landed; re-drive from live chain state
 *                              (idempotent: an already-present account is a skip).
 */
export type ReconcileDecision = "land" | "wait" | "reprocess";

export function classifyReconcileState(state: SignatureState): ReconcileDecision {
  if (state === "finalized") return "land";
  if (state === "confirmed") return "wait";
  return "reprocess";
}

/**
 * The job's cluster (bound at enqueue) MUST match the cluster the worker's RPC is
 * pinned to. A devnet job queued before a switch to mainnet would otherwise be
 * signed and broadcast on mainnet with a devnet label. Genesis-hash binding only
 * proves the RPC serves ctx.config.cluster; it cannot catch a job that belongs to
 * the OTHER cluster. Mismatch is a permanent (non-retryable) failure: the job can
 * never be valid on this cluster, so it must fail without broadcasting rather than
 * dead-letter after burning retries.
 */
export function assertJobClusterMatches(jobCluster: string, configCluster: string): void {
  if (jobCluster !== configCluster) {
    throw new SasIssuerError(
      `Job cluster ${jobCluster} does not match worker cluster ${configCluster}; refusing to sign`,
      false,
    );
  }
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
 * Reconcile a job that persisted a signature before an ambiguous send. Runs
 * whenever a signature is persisted, regardless of the claimed-from status.
 *
 * Two shapes exist:
 *   * A reissue whose CLOSE phase persisted only pending_close_signature (create
 *     not yet started): reconcile the close and, if it FINALIZED, advance the job
 *     to its create phase. The create runs as its own later claim.
 *   * A create (issue/reissue create phase) or a pure close whose
 *     pending_signature is set: complete/close from that FINALIZED signature.
 *
 * Only a FINALIZED signature is landed. A 'confirmed' signature has landed but is
 * not yet irreversible, so we neither advance nor re-drive: return "wait" and the
 * caller backs the job off WITHOUT resending, retaining the persisted signature so
 * a later claim reconciles the SAME signature once it finalizes. A failed or
 * never-landed signature returns "reprocess" so the caller re-drives from live
 * chain state (idempotently: an already-present account resolves to a skip).
 */
async function reconcilePendingJob(
  ctx: AttestationContext,
  job: OutboxJob,
): Promise<"reconciled" | "advanced" | "reprocess" | "wait"> {
  // Reissue close phase in flight: only the close signature is persisted.
  if (!job.pending_signature && job.operation === "reissue" && job.pending_close_signature) {
    const closeSig = job.pending_close_signature;
    const decision = classifyReconcileState(await reconcileSignature(ctx, closeSig));
    // A confirmed-but-not-finalized close waits (never re-drive a landed close: it
    // would double-close and dead-letter). Only a genuinely un-landed close re-drives.
    if (decision === "wait") return "wait";
    if (decision === "reprocess") return "reprocess";
    const pda = (await buildCloseInstruction(ctx, job.mint)).attestationPda;
    await advanceReissueToCreate({
      id: job.id,
      leaseToken: job.lease_token as string,
      cluster: job.cluster,
      mint: job.mint,
      schemaVersion: job.desired_schema_version ?? SCHEMA_VERSION,
      attestationPda: pda.toString(),
      closeSignature: closeSig,
    });
    return "advanced";
  }

  const signature = job.pending_signature;
  if (!signature) return "reprocess";
  const decision = classifyReconcileState(await reconcileSignature(ctx, signature));
  // Landed only at FINALIZED. A 'confirmed' (landed, not yet finalized) waits so a
  // fork rollback can never leave a recorded generation on a reverted tx; a failed
  // or never-landed signature re-drives from live chain state.
  if (decision === "wait") return "wait";
  if (decision === "reprocess") return "reprocess";

  // The landed transaction is a CREATE (issue / reissue create phase) or a pure
  // close. A reissue whose create landed carries operation 'issue' by now (the
  // close phase already advanced it), so only a genuine 'close' job closes here.
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
 * Broadcast a create/pure-close transaction with the persist-before-broadcast
 * fence: the signature is stored as pending_signature first. markBroadcast MUST
 * return true; a false result means the lease was lost and we abort WITHOUT
 * broadcasting, so a stale worker never lands an effect it can no longer commit.
 */
async function broadcastFenced(
  ctx: AttestationContext,
  job: OutboxJob,
  instruction: Awaited<ReturnType<typeof buildCreateInstruction>>["instruction"],
): Promise<string> {
  const { signature, signed } = await prepareInstructions(ctx, [instruction]);
  const persisted = await markBroadcast(
    job.id,
    job.lease_token as string,
    signature,
    job.pending_close_signature,
  );
  if (!persisted) {
    throw new SasIssuerError("Lost lease before broadcast; aborting", false);
  }
  await broadcastPrepared(ctx, signed);
  return signature;
}

type ProcessOutcome = "completed" | "reconciled" | "advanced" | "skipped" | "waiting";

async function processJob(
  ctx: AttestationContext,
  job: OutboxJob,
  claimedFromStatus: string,
): Promise<ProcessOutcome> {
  // Cluster fence FIRST, before any chain read or signature: a job enqueued for a
  // different cluster than this worker is pinned to must never be signed here. The
  // genesis-hash check only proves the RPC serves ctx.config.cluster, not that the
  // job belongs to it, so a devnet job left in the queue across a switch to mainnet
  // would otherwise issue on mainnet with a devnet label. Permanent failure.
  assertJobClusterMatches(job.cluster, ctx.config.cluster);

  // A job carrying ANY persisted signature (create or reissue-close phase) is
  // reconciled from chain first, regardless of the status it was claimed from.
  // Reconciliation keys on the persisted signature, not the claimed status, so a
  // job claimed from 'broadcast' reconciles rather than resends. We still assert
  // the claimed-from invariant: a 'broadcast' claim MUST carry a signature.
  const hasSignature = Boolean(job.pending_signature || job.pending_close_signature);
  if (claimedFromStatus === "broadcast" && !hasSignature) {
    throw new SasIssuerError("Broadcast job claimed without a persisted signature", false);
  }
  if (hasSignature) {
    const outcome = await reconcilePendingJob(ctx, job);
    if (outcome === "reconciled") return "reconciled";
    if (outcome === "advanced") return "advanced";
    // The signature landed but is not yet finalized: back off and reconcile the
    // SAME signature on a later claim. Do NOT fall through to re-drive, which would
    // resend a landed effect. The caller backs the row off via backoffBroadcastJob,
    // which keeps status='broadcast' and retains the signature so the next claim
    // reconciles it again once it finalizes.
    if (outcome === "wait") return "waiting";
  }

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

  if (decision === "reissue" && (await attestationExists(ctx, job.mint))) {
    // Reissue with the stale account still present: run the CLOSE phase as its
    // own durable step. Persist only the close signature, broadcast, then advance
    // the job to its create phase, which runs on the next claim with its own
    // lease, signature, and reconciliation. (If the account is already absent we
    // fall through and create directly.)
    const { signature, signed } = await prepareInstructions(ctx, [
      (await buildCloseInstruction(ctx, job.mint)).instruction,
    ]);
    const persisted = await markCloseBroadcast(job.id, job.lease_token as string, signature);
    if (!persisted) throw new SasIssuerError("Lost lease before close broadcast; aborting", false);
    await broadcastPrepared(ctx, signed);
    const pda = (await buildCloseInstruction(ctx, job.mint)).attestationPda;
    await advanceReissueToCreate({
      id: job.id,
      leaseToken: job.lease_token as string,
      cluster: job.cluster,
      mint: job.mint,
      schemaVersion: evidence.schemaVersion,
      attestationPda: pda.toString(),
      closeSignature: signature,
    });
    return "advanced";
  }

  // Fresh issue, or a reissue whose account is already absent: create directly.
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
  const signature = await broadcastFenced(ctx, job, instruction);
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
  const signature = await broadcastFenced(ctx, job, instruction);
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
    advanced: 0,
    skipped: 0,
    waiting: 0,
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
      else if (outcome === "advanced") result.advanced++;
      else if (outcome === "skipped") result.skipped++;
      else if (outcome === "waiting") {
        // Landed-but-not-finalized: back off WITHOUT leaving 'broadcast'. Routing
        // this through failAttestationJob would flip the row to 'failed'; the next
        // claim would then move it 'failed' -> 'leased', and the finalized-
        // reconciliation completion RPCs (which require status='broadcast') would
        // raise. backoffBroadcastJob keeps status='broadcast' with the signature
        // intact and only bumps the backoff, so finalized reconciliation still
        // applies on a later claim. Not a failure of the job.
        result.waiting++;
        await backoffBroadcastJob(job.id, job.lease_token as string);
      } else result.completed++;
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
