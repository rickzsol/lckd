const QUOTE_API = "https://quote-api.jup.ag/v6/quote";
const SWAP_API = "https://quote-api.jup.ag/v6/swap";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const LAMPORTS_PER_SOL = 1_000_000_000;

export interface QuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: RoutePlan[];
}

interface RoutePlan {
  swapInfo: {
    ammKey: string;
    label: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    feeAmount: string;
    feeMint: string;
  };
  percent: number;
}

export interface SwapResponse {
  swapTransaction: string;
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
}

export function solToLamports(sol: number): number {
  return Math.round(sol * LAMPORTS_PER_SOL);
}

export function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

export function formatTokenAmount(raw: string, decimals = 6): string {
  const num = Number(raw) / Math.pow(10, decimals);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  if (num >= 1) return num.toFixed(2);
  if (num >= 0.001) return num.toFixed(4);
  return num.toExponential(2);
}

export async function getQuote(
  outputMint: string,
  amountLamports: number,
  slippageBps: number,
): Promise<QuoteResponse> {
  const params = new URLSearchParams({
    inputMint: SOL_MINT,
    outputMint,
    amount: String(amountLamports),
    slippageBps: String(slippageBps),
    swapMode: "ExactIn",
  });

  const res = await fetch(`${QUOTE_API}?${params}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Quote failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function getSwapTransaction(
  quoteResponse: QuoteResponse,
  userPublicKey: string,
): Promise<SwapResponse> {
  const res = await fetch(SWAP_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Swap transaction failed: ${res.status} ${text}`);
  }
  return res.json();
}
