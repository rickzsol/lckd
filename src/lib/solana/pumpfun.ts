import {
  DEFAULT_PRIORITY_FEE_SOL,
  DEFAULT_SLIPPAGE_BPS,
  PUMPFUN_TOKEN_DECIMALS,
  PUMPPORTAL_TRADE_URL,
} from "./constants";

export interface PumpPortalCreateParams {
  creatorPublicKey: string;
  mintPublicKey: string;
  name: string;
  symbol: string;
  metadataUri: string;
  buyAmountSol: number;
  slippagePercent?: number;
  priorityFeeSol?: number;
}

export async function fetchPumpPortalCreateTx(
  params: PumpPortalCreateParams,
): Promise<Uint8Array> {
  const {
    creatorPublicKey,
    mintPublicKey,
    name,
    symbol,
    metadataUri,
    buyAmountSol,
    slippagePercent = DEFAULT_SLIPPAGE_BPS / 100,
    priorityFeeSol = DEFAULT_PRIORITY_FEE_SOL,
  } = params;

  if (!Number.isFinite(buyAmountSol) || buyAmountSol <= 0) {
    throw new Error("Buy amount must be greater than 0 SOL");
  }

  const response = await fetch(PUMPPORTAL_TRADE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey: creatorPublicKey,
      action: "create",
      tokenMetadata: { name, symbol, uri: metadataUri },
      mint: mintPublicKey,
      denominatedInSol: "true",
      amount: buyAmountSol,
      slippage: slippagePercent,
      priorityFee: priorityFeeSol,
      pool: "pump",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`PumpPortal create tx failed (${response.status}): ${errorText}`);
  }

  const txBytes = new Uint8Array(await response.arrayBuffer());
  if (txBytes.length === 0) throw new Error("PumpPortal returned an empty transaction");
  return txBytes;
}

export function estimateTokensFromSol(solAmount: number): bigint {
  const initialVirtualSolReserves = 30;
  const initialVirtualTokenReserves = 1_073_000_000;
  const tokensPerSol = initialVirtualTokenReserves / initialVirtualSolReserves;
  return BigInt(
    Math.floor(solAmount * tokensPerSol * 10 ** PUMPFUN_TOKEN_DECIMALS),
  );
}
