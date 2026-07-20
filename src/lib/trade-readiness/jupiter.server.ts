import "server-only";

import type { BuyPreview, TradeReadinessQuotes } from "./types";

const JUPITER_ORDER_URL = "https://api.jup.ag/swap/v2/order";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const SOL_AMOUNTS = [0.1, 0.5, 1] as const;
const KEYLESS_DELAY_MS = 2_100;
const KEYED_DELAY_MS = 1_100;

interface JupiterOrder {
  inAmount: string;
  inUsdValue: number | null;
  outAmount: string;
  outUsdValue: number | null;
  priceImpact: number | null;
  priceImpactPct: string | null;
  router: string;
}

function optionalFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseJupiterOrder(value: unknown): JupiterOrder {
  if (!value || typeof value !== "object") throw new Error("Jupiter response is invalid");
  const row = value as Record<string, unknown>;
  if (
    typeof row.inAmount !== "string" || !/^\d+$/.test(row.inAmount) ||
    typeof row.outAmount !== "string" || !/^\d+$/.test(row.outAmount) ||
    typeof row.router !== "string" || row.router.length === 0
  ) {
    throw new Error("Jupiter quote fields are invalid");
  }
  return {
    inAmount: row.inAmount,
    inUsdValue: optionalFiniteNumber(row.inUsdValue),
    outAmount: row.outAmount,
    outUsdValue: optionalFiniteNumber(row.outUsdValue),
    priceImpact: optionalFiniteNumber(row.priceImpact),
    priceImpactPct: typeof row.priceImpactPct === "string" ? row.priceImpactPct : null,
    router: row.router,
  };
}

export function normalizedImpactPercent(order: JupiterOrder): number | null {
  const legacyDecimal = Number(order.priceImpactPct);
  if (order.priceImpactPct !== null && Number.isFinite(legacyDecimal)) {
    return Math.abs(legacyDecimal * 100);
  }
  if (order.inUsdValue && order.outUsdValue !== null) {
    return Math.abs(((order.outUsdValue / order.inUsdValue) - 1) * 100);
  }
  return order.priceImpact === null ? null : Math.abs(order.priceImpact);
}

function waitForRateWindow(): Promise<void> {
  const delay = process.env.JUPITER_API_KEY ? KEYED_DELAY_MS : KEYLESS_DELAY_MS;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

async function getOrder(inputMint: string, outputMint: string, amount: string): Promise<JupiterOrder> {
  const url = new URL(JUPITER_ORDER_URL);
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", amount);
  const headers: HeadersInit = { Accept: "application/json" };
  if (process.env.JUPITER_API_KEY) headers["x-api-key"] = process.env.JUPITER_API_KEY;
  const response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Jupiter returned ${response.status}`);
  return parseJupiterOrder(await response.json());
}

function unknownBuy(amountSol: number): BuyPreview {
  return {
    amountSol,
    estimatedTokenRaw: null,
    impactPercent: null,
    router: null,
    status: "unknown",
  };
}

async function loadBuy(mintAddress: string, amountSol: number): Promise<BuyPreview> {
  try {
    const order = await getOrder(SOL_MINT, mintAddress, String(Math.round(amountSol * 1_000_000_000)));
    return {
      amountSol,
      estimatedTokenRaw: order.outAmount,
      impactPercent: normalizedImpactPercent(order),
      router: order.router,
      status: BigInt(order.outAmount) > BigInt(0) ? "available" : "unknown",
    };
  } catch {
    return unknownBuy(amountSol);
  }
}

export async function loadTradeReadinessQuotes(mintAddress: string): Promise<TradeReadinessQuotes> {
  const buys: BuyPreview[] = [];
  for (const amount of SOL_AMOUNTS) {
    if (buys.length > 0) await waitForRateWindow();
    buys.push(await loadBuy(mintAddress, amount));
  }

  const baseline = buys[0];
  let reverse: TradeReadinessQuotes["reverse"] = null;
  if (baseline?.estimatedTokenRaw) {
    await waitForRateWindow();
    try {
      const order = await getOrder(mintAddress, SOL_MINT, baseline.estimatedTokenRaw);
      const estimatedSol = Number(order.outAmount) / 1_000_000_000;
      reverse = {
        estimatedSol,
        isAvailable: estimatedSol > 0,
        retainedPercent: estimatedSol / baseline.amountSol * 100,
        router: order.router,
      };
    } catch {
      reverse = { estimatedSol: null, isAvailable: false, retainedPercent: null, router: null };
    }
  }

  return { asOf: new Date().toISOString(), buys, mintAddress, reverse };
}
