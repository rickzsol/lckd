import { getSupabase, hasSupabaseConfig } from "./supabase";

export const LCKD_MINT = "7UTubJ3W6JWwLUj82B9LgHFDmc8wFWtSNLis6u8epump";
export const LCKD_INITIAL_SUPPLY = 1_000_000_000;

export interface BurnEvent {
  kind: "buyback" | "burn";
  signature: string;
  solAmount: number | null;
  lckdAmount: number | null;
  executedAt: string;
}

export interface BurnLedger {
  available: boolean;
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

interface BurnEventRow {
  kind: string;
  signature: string;
  sol_amount: number | string | null;
  lckd_amount: number | string | null;
  executed_at: string;
}

function toNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getBurnLedger(): Promise<BurnLedger> {
  const supply = { current: await fetchLckdSupply(), initial: LCKD_INITIAL_SUPPLY };
  if (!hasSupabaseConfig()) return { ...EMPTY_LEDGER, supply };

  try {
    const { data, error } = await getSupabase()
      .from("burn_events")
      .select("kind, signature, sol_amount, lckd_amount, executed_at")
      .order("executed_at", { ascending: false })
      .limit(200);
    // The ledger table ships with the treasury worker; until it exists the
    // page reports the pre-first-burn state instead of failing.
    if (error) return { ...EMPTY_LEDGER, supply };

    const events: BurnEvent[] = (data as BurnEventRow[])
      .filter((row) => row.kind === "buyback" || row.kind === "burn")
      .map((row) => ({
        kind: row.kind as BurnEvent["kind"],
        signature: row.signature,
        solAmount: toNumber(row.sol_amount),
        lckdAmount: toNumber(row.lckd_amount),
        executedAt: row.executed_at,
      }));

    const totals = events.reduce(
      (accumulated, event) => {
        if (event.kind === "buyback") {
          accumulated.solSpent += event.solAmount ?? 0;
          accumulated.lckdBought += event.lckdAmount ?? 0;
        } else {
          accumulated.lckdBurned += event.lckdAmount ?? 0;
        }
        return accumulated;
      },
      { solSpent: 0, lckdBought: 0, lckdBurned: 0 },
    );

    return { available: true, totals, supply, events };
  } catch {
    return { ...EMPTY_LEDGER, supply };
  }
}
