import { TrustTier } from "@/types/index";
import type { AttestationBlock, LockPublicRow, LockStatus } from "@/types/trust";
import { deriveLockStatus, unlockEligibleAt } from "./projection";

const TIER_SLUGS: Record<TrustTier, string> = {
  [TrustTier.LOCKED]: "locked",
  [TrustTier.VERIFIED]: "verified",
  [TrustTier.BUILDER]: "builder",
  [TrustTier.SHIPPED]: "shipped",
};

export function tierSlug(tier: TrustTier): string {
  return TIER_SLUGS[tier] ?? "locked";
}

export interface LockResponseBlock {
  verified: boolean;
  streamId: string;
  streamProgram: string;
  amount: string;
  withdrawnAmount: string;
  pctOfSupply: number | null;
  lockBps: number | null;
  cliffTs: string;
  status: LockStatus;
  unlockEligibleAt: string | null;
  lastVerifiedAt: string | null;
}

/**
 * Basis-point supply share derived from the finalized denominator persisted on
 * the lock (raw supply + decimals), never from tokens.lock_percentage. Null when
 * the denominator has not been backfilled yet, so callers render "unknown"
 * rather than a wrong number.
 */
export function pctOfSupply(depositedAmount: string, totalSupplyRaw: number | null): number | null {
  if (totalSupplyRaw === null || totalSupplyRaw <= 0) return null;
  const deposited = Number(depositedAmount);
  if (!Number.isFinite(deposited)) return null;
  return (deposited / totalSupplyRaw) * 100;
}

export function buildLockBlock(row: LockPublicRow, now: number): LockResponseBlock {
  const status = deriveLockStatus(row.status, row.cliff_ts, now);
  return {
    verified: true,
    streamId: row.stream_id,
    streamProgram: row.stream_program,
    amount: row.deposited_amount,
    withdrawnAmount: row.withdrawn_amount,
    pctOfSupply: pctOfSupply(row.deposited_amount, row.total_supply_raw),
    lockBps: row.lock_bps,
    cliffTs: row.cliff_ts,
    status,
    unlockEligibleAt: unlockEligibleAt(status, row.cliff_ts),
    lastVerifiedAt: row.last_verified_at,
  };
}

export interface TrustResponseData {
  mint: string;
  tier: string;
  tierComputedAt: string | null;
  lock: LockResponseBlock | null;
  github: {
    username: string;
    accountCreatedAt: string | null;
    repo: string | null;
  } | null;
  attestation: AttestationBlock | null;
}
