import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WebhookInboxPayload } from "@/types/trust";

/** One normalized event ready for a durable idempotent inbox insert. */
export interface NormalizedEvent {
  provider: "helius";
  signature: string;
  event_type: string;
  slot: number | null;
  payload_hash: string;
  payload: WebhookInboxPayload;
}

/** Outcome of normalizing a batch. `rejected` entries are malformed items in an
 * otherwise nonempty batch; the caller fails the batch rather than acking 200
 * after silently dropping them (finding 7). */
export interface NormalizeResult {
  events: NormalizedEvent[];
  rejected: number;
}

interface RawHeliusEvent {
  signature?: unknown;
  type?: unknown;
  slot?: unknown;
  accountData?: unknown;
  accountKeys?: unknown;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asSlot(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

// Account keys are later interpolated into a PostgREST `.in(...)` filter by the
// consumer, so only accept strict base58 pubkeys (no commas/parens can smuggle
// filter syntax). Untrusted payload -> validate at the entry point.
const BASE58_PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function asPubkey(value: unknown): string | null {
  return typeof value === "string" && BASE58_PUBKEY.test(value) ? value : null;
}

/** Pulls the touched account addresses from a Helius enhanced event, bounded. */
function extractAccountKeys(event: RawHeliusEvent): string[] {
  const keys = new Set<string>();
  if (Array.isArray(event.accountData)) {
    for (const entry of event.accountData) {
      const account = asPubkey((entry as { account?: unknown })?.account);
      if (account) keys.add(account);
      if (keys.size >= 64) break;
    }
  }
  if (Array.isArray(event.accountKeys)) {
    for (const key of event.accountKeys) {
      const account = asPubkey(key);
      if (account) keys.add(account);
      if (keys.size >= 64) break;
    }
  }
  return [...keys];
}

/**
 * Normalizes a bounded Helius batch into idempotent inbox rows.
 *
 * Dedup identity is (provider, signature, event_type): stable across Helius
 * retries. event_index (batch position) is NOT used because Helius can regroup
 * or reorder retried deliveries, which would mint a fresh key for the same
 * transaction (finding 7).
 *
 * A malformed entry (not an object, or missing a signature) is counted in
 * `rejected` so the caller can fail a nonempty batch that contained garbage
 * instead of acking 200 after silently dropping it. Entries with no usable
 * account keys are also rejected: nothing downstream can act on them, so they
 * must not be persisted and marked processed.
 */
export function normalizeHeliusBatch(batch: unknown[]): NormalizeResult {
  const events: NormalizedEvent[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  for (const raw of batch) {
    if (!raw || typeof raw !== "object") {
      rejected += 1;
      continue;
    }
    const event = raw as RawHeliusEvent;
    const signature = asString(event.signature);
    if (!signature) {
      rejected += 1;
      continue;
    }

    const accountKeys = extractAccountKeys(event);
    if (accountKeys.length === 0) {
      // No addresses to correlate to a lock; acting on it is impossible.
      rejected += 1;
      continue;
    }

    const eventType = asString(event.type) ?? "UNKNOWN";
    const dedupKey = `${signature}|${eventType}`;
    if (seen.has(dedupKey)) continue; // in-batch duplicate of the same subevent.
    seen.add(dedupKey);

    const payload: WebhookInboxPayload = {
      signature,
      slot: asSlot(event.slot),
      accountKeys,
    };
    events.push({
      provider: "helius",
      signature,
      event_type: eventType,
      slot: payload.slot,
      payload_hash: hashPayload(payload),
      payload,
    });
  }
  return { events, rejected };
}

function hashPayload(payload: WebhookInboxPayload): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Durable idempotent insert. Ignores duplicates via the unique constraint so
 * at-least-once delivery cannot double-process. Returns inserted count; throws
 * only when the insert itself fails (the caller maps that to a 5xx).
 */
export async function insertInboxEvents(
  supabase: SupabaseClient,
  events: NormalizedEvent[],
): Promise<number> {
  if (events.length === 0) return 0;
  const { data, error } = await supabase
    .from("webhook_inbox")
    .upsert(events, {
      onConflict: "provider,signature,event_type",
      ignoreDuplicates: true,
    })
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}
