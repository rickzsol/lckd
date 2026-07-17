import { TrustTier } from "@/types/index";
import type { LockStatus, LockPublicRow, TrustProjection } from "@/types/trust";

/** Bump when the derivation rules below change; serialized into responses and
 * attestations so consumers can pin the policy that produced a tier. */
export const TRUST_POLICY_VERSION = 1;

export interface GithubEvidence {
  /** Persisted tier the GitHub cron last computed with an active lock. */
  githubTier: TrustTier;
}

export interface LockEvidence {
  status: LockStatus;
  /** Canonical cliff for wall-clock eligibility. */
  cliffTs: string;
  lastVerifiedAt: string | null;
}

/**
 * Applies wall-clock eligibility to a stored lock status. A cliff passing
 * produces no on-chain event, so a stored `locked` row past its cliff is
 * time-eligible even before a sweep updates it. Never invents a withdrawal:
 * proven-release states (`withdrawn`) come only from chain observation.
 */
export function deriveLockStatus(
  storedStatus: LockStatus,
  cliffTs: string,
  now: number,
): LockStatus {
  if (storedStatus === "withdrawn" || storedStatus === "anomalous") {
    return storedStatus;
  }
  const cliffMs = new Date(cliffTs).getTime();
  if (!Number.isFinite(cliffMs)) return "anomalous";
  if (storedStatus === "unlock_eligible") return "unlock_eligible";
  // storedStatus === "locked"
  return now >= cliffMs ? "unlock_eligible" : "locked";
}

/** A lock still holds tier only while it is genuinely time-locked. */
export function isLockHoldingTier(status: LockStatus): boolean {
  return status === "locked";
}

/**
 * The single tier projection. Tier is the GitHub-derived tier while the lock is
 * genuinely locked; the moment the lock becomes eligible/withdrawn/anomalous the
 * token drops to the explicit expired state (tier LOCKED floor is NOT retained
 * for an eligible-but-unwithdrawn lock). Callers persist tier + tierComputedAt +
 * policyVersion transactionally and never downgrade separately at read time.
 */
export function projectTrust(
  lock: LockEvidence | null,
  github: GithubEvidence | null,
  now: number,
  computedAtIso: string,
): TrustProjection {
  if (!lock) {
    return {
      tier: TrustTier.LOCKED,
      tierComputedAt: computedAtIso,
      policyVersion: TRUST_POLICY_VERSION,
      lockStatus: null,
      isExpired: false,
    };
  }

  const lockStatus = deriveLockStatus(lock.status, lock.cliffTs, now);
  const holdsTier = isLockHoldingTier(lockStatus);
  const githubTier = github?.githubTier ?? TrustTier.LOCKED;
  // Expired means the lock no longer protects the tier: floor to LOCKED.
  const tier = holdsTier ? githubTier : TrustTier.LOCKED;

  return {
    tier,
    tierComputedAt: computedAtIso,
    policyVersion: TRUST_POLICY_VERSION,
    lockStatus,
    isExpired: !holdsTier,
  };
}

/** Public row → projection input. Reads the canonical lock row. */
export function lockEvidenceFromRow(row: LockPublicRow): LockEvidence {
  return {
    status: row.status,
    cliffTs: row.cliff_ts,
    lastVerifiedAt: row.last_verified_at,
  };
}

/**
 * Unlock-eligible timestamp: the cliff for a lock that is not yet withdrawn.
 * Null once fully withdrawn or anomalous.
 */
export function unlockEligibleAt(status: LockStatus, cliffTs: string): string | null {
  if (status === "withdrawn" || status === "anomalous") return null;
  return cliffTs;
}
