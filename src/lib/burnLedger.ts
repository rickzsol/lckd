import { getSupabase, hasSupabaseConfig } from "./supabase";

export const LCKD_MINT = "7UTubJ3W6JWwLUj82B9LgHFDmc8wFWtSNLis6u8epump";
export const LCKD_INITIAL_SUPPLY = 1_000_000_000;
const EVENT_PAGE_SIZE = 1_000;
const RECENT_EVENT_LIMIT = 200;

export interface BurnEvent {
  kind: "buyback" | "burn";
  signature: string;
  solAmount: number | null;
  lckdAmount: number | null;
  executedAt: string;
}

export interface BurnLedger {
  available: boolean;
  finality: "finalized";
  sourceOfTruth: "solana";
  totals: {
    solSpent: number;
    lckdBought: number;
    lckdBurned: number;
  };
  supply: {
    current: number | null;
    initial: number;
  };
  events: BurnEvent[];
}

const EMPTY_LEDGER: BurnLedger = {
  available: false,
  finality: "finalized",
  sourceOfTruth: "solana",
  totals: { solSpent: 0, lckdBought: 0, lckdBurned: 0 },
  supply: { current: null, initial: LCKD_INITIAL_SUPPLY },
  events: [],
};

async function fetchLckdSupply(): Promise<number | null> {
  const rpcUrl = process.env.HELIUS_RPC_URL ?? process.env.NEXT_PUBLIC_HELIUS_RPC_URL;
  if (!rpcUrl) return null;
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenSupply",
        params: [LCKD_MINT, { commitment: "finalized" }],
      }),
      next: { revalidate: 300 },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      result?: { value?: { uiAmount?: number | null } };
    };
    const uiAmount = payload.result?.value?.uiAmount;
    return typeof uiAmount === "number" && Number.isFinite(uiAmount) ? uiAmount : null;
  } catch {
    return null;
  }
}

export interface BurnEventRow {
  kind: string;
  signature: string;
  sol_amount: number | string | null;
  lckd_amount: number | string | null;
  executed_at: string;
}

function toPositiveNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseBurnEvents(rows: BurnEventRow[]): BurnEvent[] {
  return rows
    .filter((row) => row.kind === "buyback" || row.kind === "burn")
    .map((row) => ({
      kind: row.kind as BurnEvent["kind"],
      signature: row.signature,
      solAmount: toPositiveNumber(row.sol_amount),
      lckdAmount: toPositiveNumber(row.lckd_amount),
      executedAt: row.executed_at,
    }));
}

export function calculateBurnTotals(events: BurnEvent[]): BurnLedger["totals"] {
  return events.reduce(
    (totals, event) => {
      const hasBuybackAmounts = event.solAmount !== null && event.lckdAmount !== null;

      totals.solSpent += event.solAmount ?? 0;
      totals.lckdBought += hasBuybackAmounts ? event.lckdAmount ?? 0 : 0;
      totals.lckdBurned += event.kind === "burn" ? event.lckdAmount ?? 0 : 0;
      return totals;
    },
    { solSpent: 0, lckdBought: 0, lckdBurned: 0 },
  );
}

export async function getBurnLedger(): Promise<BurnLedger> {
  const supply = { current: await fetchLckdSupply(), initial: LCKD_INITIAL_SUPPLY };
  if (!hasSupabaseConfig()) return { ...EMPTY_LEDGER, supply };

  try {
    const client = getSupabase();
    const recentEvents: BurnEvent[] = [];
    let totals = { solSpent: 0, lckdBought: 0, lckdBurned: 0 };
    let offset = 0;
    while (true) {
      const { data, error } = await client
        .from("burn_events")
        .select("id, kind, signature, sol_amount, lckd_amount, executed_at")
        .order("executed_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + EVENT_PAGE_SIZE - 1);
      // Until the ledger table exists, report unavailable instead of a fake zero.
      if (error) return { ...EMPTY_LEDGER, supply };
      const page = parseBurnEvents(data as BurnEventRow[]);
      totals = addBurnTotals(totals, calculateBurnTotals(page));
      if (recentEvents.length < RECENT_EVENT_LIMIT) {
        recentEvents.push(...page.slice(0, RECENT_EVENT_LIMIT - recentEvents.length));
      }
      if ((data?.length ?? 0) < EVENT_PAGE_SIZE) break;
      offset += EVENT_PAGE_SIZE;
    }

    return {
      available: true,
      finality: "finalized",
      sourceOfTruth: "solana",
      totals,
      supply,
      events: recentEvents,
    };
  } catch {
    return { ...EMPTY_LEDGER, supply };
  }
}

function addBurnTotals(
  current: BurnLedger["totals"],
  page: BurnLedger["totals"],
): BurnLedger["totals"] {
  return {
    solSpent: current.solSpent + page.solSpent,
    lckdBought: current.lckdBought + page.lckdBought,
    lckdBurned: current.lckdBurned + page.lckdBurned,
  };
}
