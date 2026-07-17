import "server-only";

import { createHash } from "crypto";

import {
  BPS_DENOMINATOR,
  POLICY_VERSION,
  SCHEMA_VERSION,
  type TrustAttestationData,
  type TrustTierValue,
} from "./schema";

/**
 * Server-derived evidence for a trust attestation. Every field here is computed
 * from finalized chain state and server-owned GitHub evidence at issue time.
 * NO caller-supplied input ever flows into this bundle: SAS only proves that an
 * authorized signer signed these bytes, it enforces no LCKD policy, so the
 * policy must be enforced by deriving the claim ourselves.
 */
export interface TrustEvidence {
  /** Finalized token mint address. */
  mint: string;
  /** Finalized launch creator wallet. */
  creator: string;
  /** Streamflow stream/metadata account backing the lock. */
  streamId: string;
  /** Projected trust tier (1..4). */
  tier: TrustTierValue;
  /** Locked supply in basis points of finalized total mint supply. */
  lockBps: number;
  /** Unlock cliff, raw chain seconds. Doubles as the attestation expiry. */
  cliffTs: bigint;
  /** Public GitHub handle already shown on the site (empty string if none). */
  github: string;
  /** Policy version enforced when this evidence was derived. */
  policyVersion: number;
  /** Schema version the attestation is issued against. */
  schemaVersion: number;
}

export interface LockChainFacts {
  mint: string;
  creator: string;
  streamId: string;
  /** Locked deposit amount, raw base units. */
  lockedAmount: bigint;
  /** Finalized total mint supply, raw base units. */
  totalSupply: bigint;
  /** Unlock cliff, raw chain seconds. */
  cliffTs: bigint;
}

/**
 * Compute locked supply as basis points of finalized total mint supply.
 * Uses the finalized supply denominator, never the deposited/purchased basis
 * that `tokens.lock_percentage` records.
 */
export function computeLockBps(lockedAmount: bigint, totalSupply: bigint): number {
  if (lockedAmount < BigInt(0) || totalSupply <= BigInt(0) || lockedAmount > totalSupply) {
    throw new Error("Invalid lock supply inputs for basis-point computation");
  }
  const bps = (lockedAmount * BigInt(BPS_DENOMINATOR)) / totalSupply;
  return Number(bps);
}

/**
 * Assemble the canonical trust evidence from finalized chain facts and the
 * server-owned GitHub handle. Tier is supplied by the single trust projection
 * (the one authority), never recomputed ad hoc here.
 */
export function assembleTrustEvidence(
  facts: LockChainFacts,
  tier: TrustTierValue,
  github: string,
): TrustEvidence {
  const lockBps = computeLockBps(facts.lockedAmount, facts.totalSupply);
  return {
    mint: facts.mint,
    creator: facts.creator,
    streamId: facts.streamId,
    tier,
    lockBps,
    cliffTs: facts.cliffTs,
    github: github ?? "",
    policyVersion: POLICY_VERSION,
    schemaVersion: SCHEMA_VERSION,
  };
}

/** Project evidence into the exact on-chain attestation payload shape. */
export function evidenceToAttestationData(evidence: TrustEvidence): TrustAttestationData {
  return {
    mint: evidence.mint,
    creator: evidence.creator,
    stream_id: evidence.streamId,
    tier: evidence.tier,
    lock_bps: evidence.lockBps,
    cliff_ts: evidence.cliffTs,
    policy_version: evidence.policyVersion,
    github: evidence.github,
  };
}

/**
 * Stable SHA-256 hash of the evidence bundle. The hash is order-independent and
 * deterministic across runs so a GitHub or tier change reliably produces a new
 * hash (triggering reissue) and an unchanged claim reliably produces the same
 * hash (enabling idempotency). Stored in `attestations.evidence_hash`.
 */
export function hashEvidence(evidence: TrustEvidence): string {
  const canonical = [
    ["mint", evidence.mint],
    ["creator", evidence.creator],
    ["streamId", evidence.streamId],
    ["tier", String(evidence.tier)],
    ["lockBps", String(evidence.lockBps)],
    ["cliffTs", evidence.cliffTs.toString()],
    ["github", evidence.github],
    ["policyVersion", String(evidence.policyVersion)],
    ["schemaVersion", String(evidence.schemaVersion)],
  ]
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
