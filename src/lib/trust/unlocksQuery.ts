import { hasSupabaseConfig } from "@/lib/supabase";
import { deriveLockStatus, unlockEligibleAt } from "./projection";
import { pctOfSupply } from "./response";
import { TrustTier } from "@/types/index";
import type { LockPublicRow, LockStatus } from "@/types/trust";

/** Trailing window keeps recently-overdue eligible rows visible on the board. */
const TRAILING_WINDOW_DAYS = 30;
/** Forward horizon for upcoming cliffs shown on the calendar. */
const FORWARD_WINDOW_DAYS = 90;
const PAGE_CAP = 200;
const DAY_MS = 86_400_000;

/** A single calendar row: mirrors the public API `items[]` shape plus the
 * token image and derived trust tier used by the page. */
export interface UnlockCalendarRow {
  mint: string;
  name: string | null;
  ticker: string | null;
  image: string | null;
  tier: TrustTier;
  amount: string;
  withdrawnAmount: string;
  pctOfSupply: number | null;
  cliffTs: string;
  status: LockStatus;
  unlockEligibleAt: string | null;
}

type RawRow = Pick<
  LockPublicRow,
  | "mint"
  | "deposited_amount"
  | "withdrawn_amount"
  | "total_supply_raw"
  | "cliff_ts"
  | "status"
  | "token_name"
  | "token_ticker"
  | "token_image_uri"
  | "token_trust_tier"
>;

function toRow(row: RawRow, now: number): UnlockCalendarRow {
  const status = deriveLockStatus(row.status, row.cliff_ts, now);
  return {
    mint: row.mint,
    name: row.token_name ?? null,
    ticker: row.token_ticker ?? null,
    image: row.token_image_uri ?? null,
    tier: (row.token_trust_tier as TrustTier | null) ?? TrustTier.LOCKED,
    amount: row.deposited_amount,
    withdrawnAmount: row.withdrawn_amount,
    pctOfSupply: pctOfSupply(row.deposited_amount, row.total_supply_raw),
    cliffTs: row.cliff_ts,
    status,
    unlockEligibleAt: unlockEligibleAt(status, row.cliff_ts),
  };
}

/**
 * Result of a calendar read. `status` distinguishes a genuine empty board
 * ("ok" with no rows) from a degraded read (unconfigured or query failure), so
 * the page can say "temporarily unavailable" instead of "nothing is unlocking",
 * which would be a false statement built from a failure (finding 11).
 */
export type UnlockCalendarResult =
  | { status: "ok"; rows: UnlockCalendarRow[] }
  | { status: "degraded"; rows: [] };

/**
 * Reads the `locks_public` view directly for the calendar page. Bounds the
 * result to a trailing 30d / forward 90d cliff window, canonical + active locks
 * only, ordered by cliff ascending, capped at 200 rows. Returns a degraded
 * result on missing config or a query error rather than an empty success.
 */
export async function getUpcomingUnlocks(): Promise<UnlockCalendarResult> {
  if (!hasSupabaseConfig()) return { status: "degraded", rows: [] };

  try {
    const { getSupabase } = await import("@/lib/supabase");
    const now = Date.now();
    const windowStart = new Date(now - TRAILING_WINDOW_DAYS * DAY_MS).toISOString();
    const windowEnd = new Date(now + FORWARD_WINDOW_DAYS * DAY_MS).toISOString();

    const { data, error } = await getSupabase()
      .from("locks_public")
      .select(
        "mint, deposited_amount, withdrawn_amount, total_supply_raw, cliff_ts, status, canonical, token_name, token_ticker, token_image_uri, token_trust_tier",
      )
      .in("status", ["locked", "unlock_eligible"])
      .eq("canonical", true)
      .gte("cliff_ts", windowStart)
      .lte("cliff_ts", windowEnd)
      .order("cliff_ts", { ascending: true })
      .order("mint", { ascending: true })
      .limit(PAGE_CAP);

    if (error || !data) {
      if (error) console.error("[getUpcomingUnlocks] query failed:", error.message);
      return { status: "degraded", rows: [] };
    }
    return { status: "ok", rows: (data as unknown as RawRow[]).map((row) => toRow(row, now)) };
  } catch (err) {
    console.error("[getUpcomingUnlocks]", err instanceof Error ? err.message : err);
    return { status: "degraded", rows: [] };
  }
}

/** Soonest upcoming (or overdue-eligible) unlock, or null when empty/degraded.
 * The feed strip treats a degraded read as "no data to show" rather than an
 * error surface, but never as a positive "nothing is unlocking" claim. */
export async function getNextUnlock(): Promise<UnlockCalendarRow | null> {
  const result = await getUpcomingUnlocks();
  return result.status === "ok" ? (result.rows[0] ?? null) : null;
}
