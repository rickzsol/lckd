import { NextResponse } from "next/server";
import { isValidCronSecret } from "@/lib/api/cronAuth";
import { getServerClient, hasServerSupabaseConfig } from "@/lib/supabase";
import { getFinalizedConnection } from "@/lib/trust/rpc";
import { reconcileLock } from "@/lib/trust/reconcileLock";
import { LOCK_COLUMNS } from "@/lib/trust/lockColumns";
import type { LockRow } from "@/types/trust";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Bounded, self-healing sweep. Rows are ordered by verification recency
// (last_verified_at ascending, nulls first) so never-checked and stalest locks
// always sort ahead of freshly-verified ones. reconcileLock stamps
// last_verified_at = now on every row it touches, so a processed row re-sorts to
// the back and the NEXT page naturally picks the next-stalest rows. This makes
// later locks reachable on every run with no external cursor to chain, closing
// the "permanently starves rows after the first page" gap (finding 6).
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

  for (; pages < MAX_PAGES_PER_RUN; pages += 1) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;

    const { data, error } = await supabase
      .from("locks")
      .select(LOCK_COLUMNS)
      .in("status", ["locked", "unlock_eligible", "anomalous"])
      .order("last_verified_at", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);
    if (error) {
      console.error("[reconcile-locks] fetch failed:", error.message);
      return NextResponse.json({ error: "Failed to fetch locks" }, { status: 503 });
    }

    const page = (data ?? []) as unknown as LockRow[];
    if (page.length === 0) {
      exhausted = true;
      break;
    }

    // Stop if the page is entirely rows we already verified this run: without a
    // fresh timestamp advancing the order we would re-process the same page.
    let progressedThisPage = false;
    for (const lock of page) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
      try {
        const outcome = await reconcileLock(supabase, connection, lock, Date.now());
        reconciled += 1;
        progressedThisPage = true;
        if (outcome.statusChanged) statusChanges += 1;
        if (outcome.tierChanged) tierChanges += 1;
      } catch (error) {
        console.error("[reconcile-locks] lock failed:", lock.id, error instanceof Error ? error.message : error);
        failed += 1;
      }
    }

    if (!progressedThisPage) break; // every row in the page failed; avoid a spin.
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
