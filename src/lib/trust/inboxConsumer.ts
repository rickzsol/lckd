import type { SupabaseClient } from "@supabase/supabase-js";

export const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_SECONDS = 30;
const MAX_BACKOFF_SECONDS = 3_600;

/** Exponential backoff with a ceiling: 30s, 60s, 120s, ... capped at 1h. */
export function backoffSeconds(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  const raw = BASE_BACKOFF_SECONDS * 2 ** exponent;
  return Math.min(raw, MAX_BACKOFF_SECONDS);
}

/** Whether a row has exhausted its retry budget and must be dead-lettered. */
export function shouldDeadLetter(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS;
}

/**
 * Marks a row processed via the fenced definer RPC. The update only applies when
 * the caller's `leaseId` still owns the row and it is not already processed, so a
 * worker whose lease expired cannot clobber a newer owner's result (finding 8).
 * Returns true when this worker actually committed the completion.
 */
export async function markProcessed(
  supabase: SupabaseClient,
  id: string,
  leaseId: string | null,
  processedAtIso: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("complete_inbox_row", {
    p_id: id,
    p_lease_id: leaseId,
    p_processed_at: processedAtIso,
  });
  if (error) throw new Error(error.message);
  return (data ?? 0) > 0;
}

/**
 * Records a failed attempt through the fenced definer RPC: dead-letter once the
 * budget is spent, otherwise schedule the next retry with backoff. The fence
 * (lease + not-yet-processed) prevents a stale worker from resetting a row a
 * newer worker already owns (finding 8). Returns true when the update applied.
 */
export async function recordFailure(
  supabase: SupabaseClient,
  id: string,
  leaseId: string | null,
  attempts: number,
  now: number,
): Promise<boolean> {
  const deadLetter = shouldDeadLetter(attempts);
  const nextRetry = deadLetter
    ? null
    : new Date(now + backoffSeconds(attempts) * 1_000).toISOString();
  const { data, error } = await supabase.rpc("fail_inbox_row", {
    p_id: id,
    p_lease_id: leaseId,
    p_dead_letter: deadLetter,
    p_next_retry_at: nextRetry,
  });
  if (error) throw new Error(error.message);
  return (data ?? 0) > 0;
}
