import { NextResponse } from "next/server";
import { isValidCronSecret } from "@/lib/api/cronAuth";
import { getServerClient, hasServerSupabaseConfig } from "@/lib/supabase";
import { getFinalizedConnection } from "@/lib/trust/rpc";
import { markProcessed, recordFailure } from "@/lib/trust/inboxConsumer";
import { reconcileLock } from "@/lib/trust/reconcileLock";
import type { LockRow, WebhookInboxRow } from "@/types/trust";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CLAIM_LIMIT = 25;
const LEASE_SECONDS = 120;
const LOCK_COLUMNS =
  "id, token_id, cluster, mint, stream_program, stream_id, escrow_ata, recipient, deposited_amount, cliff_ts, cliff_ts_raw, withdrawn_amount, total_supply_raw, decimals, lock_bps, status, canonical, creation_signature, creation_slot, last_verified_signature, last_verified_slot, last_verified_at, created_at";

/**
 * Inbox consumer: claims leased webhook rows, verifies the touched streams at
 * finalized commitment, and reconciles lock + tier state. The webhook is only an
 * invalidation hint; the chain is the truth. Failures back off; exhausted rows
 * dead-letter.
 */
export async function GET(request: Request) {
  if (!isValidCronSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasServerSupabaseConfig()) {
    return NextResponse.json({ error: "Cron service unavailable" }, { status: 503 });
  }

  const supabase = getServerClient();
  const { data: claimed, error: claimError } = await supabase.rpc("claim_webhook_inbox", {
    p_limit: CLAIM_LIMIT,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (claimError) {
    console.error("[consume-webhooks] claim failed:", claimError.message);
    return NextResponse.json({ error: "Failed to claim inbox rows" }, { status: 503 });
  }

  const rows = (claimed ?? []) as WebhookInboxRow[];
  if (rows.length === 0) {
    return NextResponse.json({ processed: 0, failed: 0, reconciled: 0 });
  }

  const connection = getFinalizedConnection();
  let processed = 0;
  let failed = 0;
  let reconciled = 0;

  for (const row of rows) {
    const now = Date.now();
    try {
      reconciled += await processRow(supabase, connection, row, now);
      await markProcessed(supabase, row.id, new Date(now).toISOString());
      processed += 1;
    } catch (error) {
      console.error("[consume-webhooks] row failed:", row.id, error instanceof Error ? error.message : error);
      await recordFailure(supabase, row.id, row.attempts, now).catch((e) =>
        console.error("[consume-webhooks] failure bookkeeping failed:", e),
      );
      failed += 1;
    }
  }

  return NextResponse.json({ processed, failed, reconciled });
}

/** Reconciles every non-withdrawn lock whose stream/escrow the event touched. */
async function processRow(
  supabase: ReturnType<typeof getServerClient>,
  connection: ReturnType<typeof getFinalizedConnection>,
  row: WebhookInboxRow,
  now: number,
): Promise<number> {
  const accountKeys = row.payload?.accountKeys ?? [];
  if (accountKeys.length === 0) return 0;

  const { data: locks, error } = await supabase
    .from("locks")
    .select(LOCK_COLUMNS)
    .or(`stream_id.in.(${accountKeys.join(",")}),escrow_ata.in.(${accountKeys.join(",")})`)
    .neq("status", "withdrawn");
  if (error) throw new Error(`lock match failed: ${error.message}`);

  let reconciled = 0;
  for (const lock of (locks ?? []) as LockRow[]) {
    await reconcileLock(supabase, connection, lock, now, row.signature, row.slot);
    reconciled += 1;
  }
  return reconciled;
}
