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

export async function markProcessed(
  supabase: SupabaseClient,
  id: string,
  processedAtIso: string,
): Promise<void> {
  const { error } = await supabase
    .from("webhook_inbox")
    .update({ processed_at: processedAtIso, locked_until: null })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Records a failed attempt: dead-letter once the budget is spent, otherwise
 * schedule the next retry with backoff and release the lease.
 */
export async function recordFailure(
  supabase: SupabaseClient,
  id: string,
  attempts: number,
  now: number,
): Promise<void> {
  if (shouldDeadLetter(attempts)) {
    const { error } = await supabase
      .from("webhook_inbox")
      .update({ dead_lettered: true, locked_until: null })
      .eq("id", id);
    if (error) throw new Error(error.message);
    return;
  }
  const nextRetry = new Date(now + backoffSeconds(attempts) * 1_000).toISOString();
  const { error } = await supabase
    .from("webhook_inbox")
    .update({ next_retry_at: nextRetry, locked_until: null })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
