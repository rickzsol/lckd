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
 * Computes staleness from the projected tier's compute time and (when a canonical
 * lock is present) its last finalized verification time. A missing tier timestamp
 * is stale. A canonical lock whose last_verified_at is null is UNVERIFIED, not
 * fresh: it is indistinguishable from a lock that has never been checked on chain,
 * so it must degrade to stale rather than pass silently (finding 11).
 */
export function isTrustStale(
  tierComputedAt: string | null,
  hasCanonicalLock: boolean,
  lockVerifiedAt: string | null,
  now: number,
): boolean {
  if (isOlderThan(tierComputedAt, TIER_FRESH_MS, now)) return true;
  if (hasCanonicalLock && isOlderThan(lockVerifiedAt, LOCK_FRESH_MS, now)) {
    // isOlderThan treats null as not-fresh, so a null-verified canonical lock is
    // stale here rather than skipped.
    return true;
  }
  return false;
}
