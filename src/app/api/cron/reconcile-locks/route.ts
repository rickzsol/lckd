import { NextResponse } from "next/server";
import { isValidCronSecret } from "@/lib/api/cronAuth";
import { getServerClient, hasServerSupabaseConfig } from "@/lib/supabase";
import { getFinalizedConnection } from "@/lib/trust/rpc";
import { reconcileLock } from "@/lib/trust/reconcileLock";
import { LOCK_COLUMNS } from "@/lib/trust/lockColumns";
import type { LockRow } from "@/types/trust";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Bounded, self-healing sweep. Rows are ordered by ATTEMPT recency
// (last_attempt_at ascending, nulls first) so never-attempted and stalest locks
// sort ahead of recently-attempted ones. Crucially last_attempt_at is stamped on
// every attempt INCLUDING failures (mark_lock_attempt), so a lock that keeps
// failing (RPC down, unconfirmed absence) still advances and rotates out of the
// head instead of monopolizing page 1 on every run and starving the rest
// (finding 6). Within a run we also track processed ids and exclude them from
// later page fetches, so a row can't be re-touched before its stamp lands.
//
// Each run keeps paging until it exhausts the backlog OR its work/time budget is
// spent, so one daily invocation with no query param makes forward progress
// across the whole table instead of re-checking only the first page.
const PAGE_SIZE = 40;
const MAX_PAGES_PER_RUN = 10; // hard work cap: <= 400 locks/run.
const TIME_BUDGET_MS = 45_000; // leave headroom under maxDuration.

export async function GET(request: Request) {
  if (!isValidCronSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasServerSupabaseConfig()) {
    return NextResponse.json({ error: "Cron service unavailable" }, { status: 503 });
  }

  const supabase = getServerClient();
  const connection = getFinalizedConnection();
  const startedAt = Date.now();

  let reconciled = 0;
  let statusChanges = 0;
  let tierChanges = 0;
  let failed = 0;
  let pages = 0;
  let exhausted = false;
  // Ids already handled this run (success or failure). Excluded from later page
  // fetches so a row is never reprocessed within one run, even before its stamp
  // is visible to the next query (finding 6).
  const processedIds = new Set<string>();

  for (; pages < MAX_PAGES_PER_RUN; pages += 1) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;

    let query = supabase
      .from("locks")
      .select(LOCK_COLUMNS)
      .in("status", ["locked", "unlock_eligible", "anomalous"])
      .order("last_attempt_at", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);
    if (processedIds.size > 0) {
      query = query.not("id", "in", `(${[...processedIds].join(",")})`);
    }

    const { data, error } = await query;
    if (error) {
      console.error("[reconcile-locks] fetch failed:", error.message);
      return NextResponse.json({ error: "Failed to fetch locks" }, { status: 503 });
    }

    const page = (data ?? []) as unknown as LockRow[];
    if (page.length === 0) {
      exhausted = true;
      break;
    }

    for (const lock of page) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
      // Mark handled up front so a failure still excludes the row from the next
      // page fetch this run, even though the commit that would stamp the DB never
      // ran. This is what stops the same failing head from being re-fetched.
      processedIds.add(lock.id);
      try {
        const outcome = await reconcileLock(supabase, connection, lock, Date.now());
        reconciled += 1;
        if (outcome.statusChanged) statusChanges += 1;
        if (outcome.tierChanged) tierChanges += 1;
      } catch (error) {
        console.error("[reconcile-locks] lock failed:", lock.id, error instanceof Error ? error.message : error);
        failed += 1;
        // Advance last_attempt_at even on failure so this lock sorts behind
        // freshly-attempted rows next run and stops monopolizing the head.
        await markLockAttempt(supabase, lock.id).catch((e) =>
          console.error("[reconcile-locks] attempt stamp failed:", lock.id, e),
        );
      }
    }

    if (page.length < PAGE_SIZE) {
      exhausted = true;
      break;
    }
  }

  return NextResponse.json({
    reconciled,
    statusChanges,
    tierChanges,
    failed,
    pages,
    exhausted,
  });
}

/** Stamps last_attempt_at through the definer RPC so a failed reconciliation
 * still advances the sweep ordering without committing any status/tier change. */
async function markLockAttempt(
  supabase: ReturnType<typeof getServerClient>,
  lockId: string,
): Promise<void> {
  const { error } = await supabase.rpc("mark_lock_attempt", {
    p_lock_id: lockId,
    p_attempted_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}
