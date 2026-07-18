/**
 * Pure mirrors of the concurrency-safety predicates enforced authoritatively in
 * SQL (`commit_token_tier`, `commit_lock_reconciliation`,
 * `backfill_coverage_complete` in 20260718000000_trust_locks.sql). The database
 * is the source of truth under real concurrency (row locks + a single
 * transaction); these functions exist so the decision rules are unit-testable and
 * documented in one place. Keep them in lockstep with the SQL.
 */

/**
 * Monotonic tier-commit gate (finding 5). A tier write only applies when its
 * evidence stamp is strictly newer than what is stored, so a racing OLDER
 * recompute (a slow worker holding a stale snapshot) is a no-op and cannot
 * clobber a fresher tier. A first write (no stored stamp) always applies.
 *
 * Mirrors the SQL:
 *   if stored_computed_at is not null and p_tier_computed_at <= stored_computed_at
 *   then return;  -- no-op
 */
export function shouldApplyTierCommit(
  storedComputedAt: string | null,
  incomingComputedAt: string,
): boolean {
  if (storedComputedAt === null) return true;
  const stored = new Date(storedComputedAt).getTime();
  const incoming = new Date(incomingComputedAt).getTime();
  if (!Number.isFinite(incoming)) return false;
  if (!Number.isFinite(stored)) return true;
  return incoming > stored;
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
