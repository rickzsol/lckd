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

interface RawRow extends Pick<
  LockPublicRow,
  "id" | "mint" | "deposited_amount" | "withdrawn_amount" | "total_supply_raw" | "cliff_ts" | "status"
> {
  tokens: {
    name: string | null;
    ticker: string | null;
    image_uri: string | null;
    trust_tier: TrustTier | null;
  } | null;
}

function toRow(row: RawRow, now: number): UnlockCalendarRow {
  const status = deriveLockStatus(row.status, row.cliff_ts, now);
  return {
    mint: row.mint,
    name: row.tokens?.name ?? null,
    ticker: row.tokens?.ticker ?? null,
    image: row.tokens?.image_uri ?? null,
    tier: row.tokens?.trust_tier ?? TrustTier.LOCKED,
    amount: row.deposited_amount,
    withdrawnAmount: row.withdrawn_amount,
    pctOfSupply: pctOfSupply(row.deposited_amount, row.total_supply_raw),
    cliffTs: row.cliff_ts,
    status,
    unlockEligibleAt: unlockEligibleAt(status, row.cliff_ts),
  };
}

/**
 * Reads the `locks_public` view directly for the calendar page. Fail-soft:
 * returns [] whenever Supabase is unconfigured or the query errors, so the
 * page renders its degraded/empty state rather than an error page. Bounds the
 * result to a trailing 30d / forward 90d cliff window, canonical + active
 * locks only, ordered by cliff ascending, capped at 200 rows.
 */
export async function getUpcomingUnlocks(): Promise<UnlockCalendarRow[]> {
  if (!hasSupabaseConfig()) return [];

  try {
    const { getSupabase } = await import("@/lib/supabase");
    const now = Date.now();
    const windowStart = new Date(now - TRAILING_WINDOW_DAYS * DAY_MS).toISOString();
    const windowEnd = new Date(now + FORWARD_WINDOW_DAYS * DAY_MS).toISOString();

    const { data, error } = await getSupabase()
      .from("locks_public")
      .select(
        "id, mint, deposited_amount, withdrawn_amount, total_supply_raw, cliff_ts, status, canonical, tokens:token_id(name, ticker, image_uri, trust_tier)",
      )
      .in("status", ["locked", "unlock_eligible"])
      .eq("canonical", true)
      .gte("cliff_ts", windowStart)
      .lte("cliff_ts", windowEnd)
      .order("cliff_ts", { ascending: true })
      .order("mint", { ascending: true })
      .limit(PAGE_CAP);

    if (error || !data) return [];
    return (data as unknown as RawRow[]).map((row) => toRow(row, now));
  } catch (err) {
    console.error("[getUpcomingUnlocks]", err instanceof Error ? err.message : err);
    return [];
  }
}

/** Soonest upcoming (or overdue-eligible) unlock, or null. Used by the feed strip. */
export async function getNextUnlock(): Promise<UnlockCalendarRow | null> {
  const rows = await getUpcomingUnlocks();
  return rows[0] ?? null;
}
