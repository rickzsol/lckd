import "server-only";

import { getServerClient } from "@/lib/supabase";
import {
  buildAttestationContext,
  buildCloseInstruction,
  buildCreateInstruction,
  broadcastPrepared,
  prepareInstructions,
  reconcileSignature,
  SasIssuerError,
  type AttestationContext,
} from "./issuer";
import {
  claimAttestationJob,
  completeAttestationJob,
  failAttestationJob,
  markBroadcast,
  type OutboxJob,
} from "./outbox";
import { hashEvidence, type TrustEvidence } from "./evidence";
import { SCHEMA_VERSION, type TrustTierValue } from "./schema";

/**
 * Outbox worker: claims one leased job and drives it to a finalized on-chain
 * effect, mirroring the repo's Robinhood recovery doctrine. The signature is
 * persisted BEFORE broadcast; an ambiguous outcome reconciles from chain by the
 * persisted signature. On-chain effects cannot be committed transactionally with
 * Postgres, so the outbox is the bridge.
 */

export interface WorkerResult {
  claimed: number;
  completed: number;
  reconciled: number;
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
  // the Streamflow metadata/stream account persisted at lock verification.
  const evidence: TrustEvidence = {
    mint: token.mint_address,
    creator: token.creator_wallet,
    streamId: token.lock_metadata_id,
    tier: job.desired_tier as TrustTierValue,
    lockBps: job.desired_lock_bps,
    cliffTs: BigInt(job.desired_cliff_ts),
    github: token.github_username ?? "",
    policyVersion: job.desired_policy_version,
    schemaVersion: SCHEMA_VERSION,
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

async function reconcileBroadcastJob(
  ctx: AttestationContext,
  job: OutboxJob,
): Promise<"reconciled" | "reprocess"> {
  const signature = job.pending_signature;
  if (!signature) return "reprocess";
  const state = await reconcileSignature(ctx, signature);
  if (state === "finalized") {
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
      lockBps: evidence.lockBps,
      cliffTs: evidence.cliffTs,
      evidenceHash: job.evidence_hash,
      expiryTs: expiryIso(evidence.cliffTs),
      txSignature: signature,
      closeSignature: job.pending_close_signature,
    });
    return "reconciled";
  }
  // Failed or never landed: fall through to reprocess with a fresh blockhash.
  return "reprocess";
}

async function processJob(ctx: AttestationContext, job: OutboxJob): Promise<"completed" | "reconciled"> {
  const leaseToken = job.lease_token as string;

  // Ambiguous prior broadcast: chain is the truth.
  if (job.status === "broadcast" && job.pending_signature) {
    const outcome = await reconcileBroadcastJob(ctx, job);
    if (outcome === "reconciled") return "reconciled";
  }

  const evidence = await evidenceForJob(job);

  const instructions = [];
  let closeSignature: string | null = null;
  if (job.operation === "reissue" || job.operation === "close") {
    const { instruction } = await buildCloseInstruction(ctx, job.mint);
    instructions.push(instruction);
  }
  if (job.operation === "issue" || job.operation === "reissue") {
    const { instruction } = await buildCreateInstruction(ctx, evidence);
    instructions.push(instruction);
  }

  const { signature, signed } = await prepareInstructions(ctx, instructions);
  if (job.operation === "reissue") closeSignature = signature;

  // Persist the signature BEFORE broadcast so an ambiguous send reconciles.
  await markBroadcast(job.id, leaseToken, signature, closeSignature);
  await broadcastPrepared(ctx, signed);

  const { attestationPda } = await buildCreateInstruction(ctx, evidence);
  await completeAttestationJob({
    id: job.id,
    leaseToken,
    tokenId: job.token_id,
    cluster: job.cluster,
    mint: job.mint,
    attestationPda: attestationPda.toString(),
    tier: evidence.tier,
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
    failed: 0,
    deadLettered: 0,
  };
  const ctx = await buildAttestationContext();

  for (let i = 0; i < maxJobs; i++) {
    const job = await claimAttestationJob();
    if (!job) break;
    result.claimed++;
    try {
      const outcome = await processJob(ctx, job);
      if (outcome === "reconciled") result.reconciled++;
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
