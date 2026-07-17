/**
 * Verification-freshness thresholds for the public trust response. `stale` must
 * reflect real freshness, not a hardcoded false: a tier computed long ago, or a
 * lock whose finalized state was last verified beyond its window, is served with
 * stale=true so consumers treat it with caution (finding 11).
 */

// GitHub cron runs hourly; 26h grace tolerates a couple of missed runs.
export const TIER_FRESH_MS = 26 * 60 * 60 * 1000;
// reconcile sweep runs daily; 48h grace tolerates one missed run.
export const LOCK_FRESH_MS = 48 * 60 * 60 * 1000;

function isOlderThan(iso: string | null, windowMs: number, now: number): boolean {
  if (!iso) return true; // never-computed is not fresh.
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return true;
  return now - ts > windowMs;
}

/**
 * Computes staleness from the projected tier's compute time and (when a lock is
 * present) its last finalized verification time. A missing tier timestamp is
 * stale; a lock timestamp is only checked when a canonical lock exists.
 */
export function isTrustStale(
  tierComputedAt: string | null,
  lockVerifiedAt: string | null,
  now: number,
): boolean {
  if (isOlderThan(tierComputedAt, TIER_FRESH_MS, now)) return true;
  if (lockVerifiedAt !== null && isOlderThan(lockVerifiedAt, LOCK_FRESH_MS, now)) {
    return true;
  }
  return false;
}
