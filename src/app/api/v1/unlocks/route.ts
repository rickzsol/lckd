import { type NextRequest } from "next/server";
import { guardPublic, publicJson, publicError, publicOptions, publicMethodNotAllowed, runPublic } from "@/lib/api/publicCors";
import { envelope, unlocksSource } from "@/lib/api/envelope";
import { decodeCursor, encodeCursor, keysetFilter, type UnlockCursor } from "@/lib/api/keyset";
import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";
import { deriveLockStatus, unlockEligibleAt } from "@/lib/trust/projection";
import { pctOfSupply } from "@/lib/trust/response";
import type { LockPublicRow, LockStatus } from "@/types/trust";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return publicOptions();
}

// Explicit non-GET handlers so unsupported methods return a public-CORS 405
// rather than an absent-CORS Next.js default (finding 13).
export const POST = publicMethodNotAllowed;
export const PUT = publicMethodNotAllowed;
export const PATCH = publicMethodNotAllowed;
export const DELETE = publicMethodNotAllowed;

const MAX_DAYS = 90;
const DEFAULT_DAYS = 30;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
// Overdue unlock_eligible rows stay visible for this trailing window rather than
// vanishing the moment their cliff passes.
const TRAILING_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

interface UnlockRow {
  mint: string;
  name: string | null;
  ticker: string | null;
  amount: string;
  withdrawnAmount: string;
  pctOfSupply: number | null;
  cliffTs: string;
  status: LockStatus;
  unlockEligibleAt: string | null;
}

function clampInt(raw: string | null, fallback: number, max: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

/**
 * Upcoming and recently-overdue cliffs, keyset-paginated on (cliff_ts, mint, id)
 * over the partial locks_cliff_idx. `days` <= 90, `limit` <= 100. A trailing 30d
 * window keeps overdue unlock_eligible rows visible.
 */
export async function GET(request: NextRequest) {
  return runPublic(async () => {
    const limited = await guardPublic(request, "trust_read");
    if (limited) return limited;

    if (!hasSupabaseConfig()) {
      return publicError("Unlock data unavailable", 503);
    }

    const url = new URL(request.url);
    const days = clampInt(url.searchParams.get("days"), DEFAULT_DAYS, MAX_DAYS);
    const limit = clampInt(url.searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);
    const cursorParam = url.searchParams.get("cursor");
    const cursor = decodeCursor(cursorParam);
    if (cursorParam && !cursor) {
      return publicError("Invalid pagination cursor", 400);
    }

    const now = Date.now();
    const windowStart = new Date(now - TRAILING_WINDOW_DAYS * DAY_MS).toISOString();
    const windowEnd = new Date(now + days * DAY_MS).toISOString();

    let query = getSupabase()
      .from("locks_public")
      .select(
        "id, mint, deposited_amount, withdrawn_amount, total_supply_raw, cliff_ts, status, canonical, tokens:token_id(name, ticker)",
      )
      .in("status", ["locked", "unlock_eligible"])
      .eq("canonical", true)
      .gte("cliff_ts", windowStart)
      .lte("cliff_ts", windowEnd)
      .order("cliff_ts", { ascending: true })
      .order("mint", { ascending: true })
      .order("id", { ascending: true })
      .limit(limit + 1);

    if (cursor) query = query.or(keysetFilter(cursor));

    const { data, error } = await query;
    if (error) {
      console.error("[unlocks] query failed:", error.message);
      return publicError("Unlock data unavailable", 503);
    }

    const rows = (data ?? []) as unknown as RawUnlockRow[];
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);

    const items = page.map((row) => toUnlockRow(row, now));
    const last = page.at(-1);
    const nextCursor = hasMore && last
      ? encodeCursor(cursorFromRow(last))
      : null;

    return publicJson(
      envelope({ items, nextCursor, days, limit }, { source: unlocksSource() }),
      200,
      { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
    );
  });
}

interface RawUnlockRow extends Pick<
  LockPublicRow,
  "id" | "mint" | "deposited_amount" | "withdrawn_amount" | "total_supply_raw" | "cliff_ts" | "status"
> {
  tokens: { name: string | null; ticker: string | null } | null;
}

function cursorFromRow(row: RawUnlockRow): UnlockCursor {
  return { cliffTs: row.cliff_ts, mint: row.mint, id: row.id };
}

function toUnlockRow(row: RawUnlockRow, now: number): UnlockRow {
  const status = deriveLockStatus(row.status, row.cliff_ts, now);
  return {
    mint: row.mint,
    name: row.tokens?.name ?? null,
    ticker: row.tokens?.ticker ?? null,
    amount: row.deposited_amount,
    withdrawnAmount: row.withdrawn_amount,
    pctOfSupply: pctOfSupply(row.deposited_amount, row.total_supply_raw),
    cliffTs: row.cliff_ts,
    status,
    unlockEligibleAt: unlockEligibleAt(status, row.cliff_ts),
  };
}
