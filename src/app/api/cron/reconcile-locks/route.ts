import { NextResponse } from "next/server";
import { isValidCronSecret } from "@/lib/api/cronAuth";
import { getServerClient, hasServerSupabaseConfig } from "@/lib/supabase";
import { getFinalizedConnection } from "@/lib/trust/rpc";
import { reconcileLock } from "@/lib/trust/reconcileLock";
import { decodeCursor, encodeCursor } from "@/lib/api/keyset";
import type { LockRow } from "@/types/trust";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Bounded, resumable sweep. Each run processes at most PER_RUN_CAP locks starting
// after the caller-supplied keyset cursor, never a full-table scan in one run.
const PER_RUN_CAP = 40;
const LOCK_COLUMNS =
  "id, token_id, cluster, mint, stream_program, stream_id, escrow_ata, recipient, deposited_amount, cliff_ts, cliff_ts_raw, withdrawn_amount, total_supply_raw, decimals, lock_bps, status, canonical, creation_signature, creation_slot, last_verified_signature, last_verified_slot, last_verified_at, created_at";

/**
 * Reconciliation sweep. Re-reads non-withdrawn streams at finalized commitment
 * to recompute time eligibility (locked -> unlock_eligible) and catch dropped
 * webhook events. Keyset-paginated on (cliff_ts, id) so it resumes from
 * `?cursor=` and returns `nextCursor` for the caller to chain across runs.
 */
export async function GET(request: Request) {
  if (!isValidCronSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasServerSupabaseConfig()) {
    return NextResponse.json({ error: "Cron service unavailable" }, { status: 503 });
  }

  const cursorParam = new URL(request.url).searchParams.get("cursor");
  const cursor = decodeCursor(cursorParam);
  if (cursorParam && !cursor) {
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  }

  const supabase = getServerClient();
  let query = supabase
    .from("locks")
    .select(LOCK_COLUMNS)
    .in("status", ["locked", "unlock_eligible", "anomalous"])
    .order("cliff_ts", { ascending: true })
    .order("id", { ascending: true })
    .limit(PER_RUN_CAP + 1);

  if (cursor) {
    query = query.or(
      `cliff_ts.gt.${cursor.cliffTs},and(cliff_ts.eq.${cursor.cliffTs},id.gt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) {
    console.error("[reconcile-locks] fetch failed:", error.message);
    return NextResponse.json({ error: "Failed to fetch locks" }, { status: 503 });
  }

  const rows = (data ?? []) as LockRow[];
  const hasMore = rows.length > PER_RUN_CAP;
  const page = rows.slice(0, PER_RUN_CAP);

  const connection = getFinalizedConnection();
  let reconciled = 0;
  let statusChanges = 0;
  let tierChanges = 0;
  let failed = 0;

  for (const lock of page) {
    try {
      const outcome = await reconcileLock(supabase, connection, lock, Date.now());
      reconciled += 1;
      if (outcome.statusChanged) statusChanges += 1;
      if (outcome.tierChanged) tierChanges += 1;
    } catch (error) {
      console.error("[reconcile-locks] lock failed:", lock.id, error instanceof Error ? error.message : error);
      failed += 1;
    }
  }

  const last = page.at(-1);
  const nextCursor = hasMore && last
    ? encodeCursor({ cliffTs: last.cliff_ts, mint: last.mint, id: last.id })
    : null;

  return NextResponse.json({ reconciled, statusChanges, tierChanges, failed, nextCursor });
}
