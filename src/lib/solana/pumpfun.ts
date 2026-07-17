import { PUMPFUN_TOKEN_DECIMALS } from "./constants";

export function estimateTokensFromSol(solAmount: number): bigint {
  const initialVirtualSolReserves = 30;
  const initialVirtualTokenReserves = 1_073_000_000;
  const tokensPerSol = initialVirtualTokenReserves / initialVirtualSolReserves;
  return BigInt(
    Math.floor(solAmount * tokensPerSol * 10 ** PUMPFUN_TOKEN_DECIMALS),
  );
}
