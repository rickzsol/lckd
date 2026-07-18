/**
 * Pure mirrors of the concurrency-safety predicates enforced authoritatively in
 * SQL (`commit_token_tier`, `commit_lock_reconciliation`,
 * `backfill_coverage_complete` in 20260718000000_trust_locks.sql). The database
 * is the source of truth under real concurrency (row locks + a compare-and-swap
 * on a monotonic evidence revision, in a single transaction); these functions
 * exist so the decision rules are unit-testable and
 * documented in one place. Keep them in lockstep with the SQL.
 */

/**
 * Monotonic tier-commit gate (finding 5, and its round-5 residual). Freshness is
 * a compare-and-swap on a monotonic evidence revision, NOT a wall-clock stamp: a
 * snapshot projected from OLD evidence but written LATER carries a newer
 * timestamp, so a timestamp comparison would let it win and clobber fresher
 * evidence. Instead the caller passes the revision it read WITH its snapshot
 * (prevSeq); the write applies only when that value still equals the stored
 * revision. A stale snapshot (prevSeq < stored, because another writer already
 * advanced the revision) is a no-op regardless of its wall-clock.
 *
 * NULL guards (round-4 new defect): a NULL computedAt or a NULL prev revision must
 * never apply -- in SQL they raise; here they return false so the caller/test sees
 * a rejected write, never a silent bypass of the monotonic guard.
 *
 * Mirrors the SQL commit_token_tier:
 *   if p_tier_computed_at is null then raise; end if;
 *   if p_prev_evidence_seq is null then raise; end if;
 *   if p_prev_evidence_seq <> stored_seq then return; end if;  -- no-op
 *   ... evidence_seq = stored_seq + 1
 */
export function shouldApplyTierCommit(
  storedEvidenceSeq: number,
  prevEvidenceSeq: number | null,
  incomingComputedAt: string | null,
): boolean {
  // Null freshness inputs never bypass the guard (SQL raises on both).
  if (incomingComputedAt === null) return false;
  if (prevEvidenceSeq === null) return false;
  if (!Number.isFinite(new Date(incomingComputedAt).getTime())) return false;
  // Compare-and-swap: fresh only if the caller's snapshot revision still matches
  // the stored one. A stale snapshot carries an older prev and loses.
  return prevEvidenceSeq === storedEvidenceSeq;
}

/** One eligible token's canonical-lock coverage, as the completeness predicate
 * evaluates it per row. */
export interface TokenCoverage {
  /** True when a canonical lock exists for this token with all three finalized
   * denominator columns (total_supply_raw, decimals, lock_bps) populated. */
  hasVerifiedCanonicalLock: boolean;
}

/**
 * Backfill completeness (finding 10): complete iff ZERO eligible tokens lack a
 * verified canonical lock. This is the per-token NOT EXISTS the SQL evaluates in
 * a single statement, never expected==done count arithmetic: one extra/stale
 * canonical row can offset one missing token so counts read "complete" while an
 * eligible token has no lock. With no eligible tokens it is trivially complete.
 *
 * Mirrors the SQL:
 *   select not exists (
 *     select 1 from tokens t
 *     where t.launch_verified_at is not null and t.lock_verified_at is not null
 *       and not exists (select 1 from locks l where l.token_id = t.id and l.canonical
 *                         and l.total_supply_raw is not null and l.decimals is not null
 *                         and l.lock_bps is not null))
 */
export function isCoverageComplete(eligibleTokens: TokenCoverage[]): boolean {
  return eligibleTokens.every((t) => t.hasVerifiedCanonicalLock);
}
