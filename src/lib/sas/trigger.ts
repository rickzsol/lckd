import "server-only";

import { assembleTrustEvidence, hashEvidence, type LockChainFacts } from "./evidence";
import { isSasEnabled, loadSasConfig, SasConfigError } from "./config";
import { enqueueAttestationJob } from "./outbox";
import { POLICY_VERSION, SCHEMA_VERSION, type TrustTierValue } from "./schema";

/**
 * Issuance triggers behind the SAS_ENABLED flag (default off). Two entry points:
 *   (a) enqueue on finalized lock verification during launch,
 *   (b) enqueue close+reissue (generation + 1) when the trust projection's tier
 *       or evidence hash changes, including GitHub evidence changes.
 *
 * The desired payload is server-derived only. This module is the seam between
 * the trust projection (the single tier authority) and the durable outbox.
 *
 * TODO(trust-api): call these from the trust projection once feature/trust-api
 * lands, passing the canonical lock record's finalized supply + stream id rather
 * than the ad hoc facts a caller assembles.
 */

export interface TriggerInput {
  tokenId: string;
  facts: LockChainFacts;
  tier: TrustTierValue;
  github: string;
  /** The evidence hash of the currently-live attestation, if any. */
  currentEvidenceHash?: string | null;
}

export type TriggerOutcome =
  | { enqueued: false; reason: "disabled" | "unconfigured" | "unchanged" }
  | { enqueued: true; jobId: string; operation: "issue" | "reissue"; evidenceHash: string };

/**
 * Derive evidence and enqueue an issuance job when the claim differs from the
 * live attestation. Skips when SAS is disabled, unconfigured, or the evidence
 * hash is unchanged (idempotency: no reissue for an identical claim).
 */
export async function triggerAttestation(input: TriggerInput): Promise<TriggerOutcome> {
  if (!isSasEnabled()) return { enqueued: false, reason: "disabled" };

  let cluster: string;
  try {
    cluster = loadSasConfig().cluster;
  } catch (error) {
    if (error instanceof SasConfigError) return { enqueued: false, reason: "unconfigured" };
    throw error;
  }

  const evidence = assembleTrustEvidence(input.facts, input.tier, input.github);
  const evidenceHash = hashEvidence(evidence);

  // Idempotency: an unchanged claim never reissues.
  if (input.currentEvidenceHash && input.currentEvidenceHash === evidenceHash) {
    return { enqueued: false, reason: "unchanged" };
  }

  const operation: "issue" | "reissue" = input.currentEvidenceHash ? "reissue" : "issue";
  const jobId = await enqueueAttestationJob({
    tokenId: input.tokenId,
    cluster,
    mint: evidence.mint,
    operation,
    tier: evidence.tier,
    lockBps: evidence.lockBps,
    cliffTs: evidence.cliffTs,
    policyVersion: POLICY_VERSION,
    schemaVersion: SCHEMA_VERSION,
    evidenceHash,
  });

  return { enqueued: true, jobId, operation, evidenceHash };
}
