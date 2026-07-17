import { LOCK_TX_SOL_OVERHEAD } from "./constants";

const LAMPORTS_PER_SOL = 1_000_000_000;

export function parseTransactionError(raw: string, buyAmountSol: number): string {
  const lamportMatch = raw.match(/insufficient lamports (\d+), need (\d+)/);
  if (lamportMatch) {
    const have = parseInt(lamportMatch[1]) / LAMPORTS_PER_SOL;
    const need = parseInt(lamportMatch[2]) / LAMPORTS_PER_SOL;
    return `Insufficient SOL. You have ${have.toFixed(3)} SOL but need ~${need.toFixed(3)} SOL (${buyAmountSol} SOL buy + fees). Fund your wallet and try again.`;
  }

  if (raw.includes("InsufficientFunds")) {
    return `Insufficient SOL for the lock transaction. Streamflow needs ~${LOCK_TX_SOL_OVERHEAD} SOL for escrow rent + fees. Fund your wallet and retry the lock.`;
  }

  if (raw.includes("insufficient") && raw.includes("token")) {
    return "Insufficient token balance for the lock amount. Try a lower lock percentage.";
  }

  if (raw.includes("timestamps are invalid")) {
    return "Token lock failed due to a timing issue. Please try again.";
  }

  if (raw.includes("could not find account") || raw.includes("No tokens found")) {
    return "Token account not found yet. Wait a few seconds for the network to confirm, then retry.";
  }

  if (raw.includes("not confirmed in") || raw.includes("unknown if it succeeded")) {
    return "Transaction was sent but confirmation timed out. Check Solscan; it may have succeeded. If not, retry.";
  }

  if (raw.includes("blockhash") && raw.includes("not found")) {
    return "Transaction expired before it could be confirmed. Please try again.";
  }

  if (raw.includes("User rejected") || raw.includes("user rejected")) {
    return "Transaction was rejected in your wallet.";
  }

  if (raw.includes("Slippage") || raw.includes("0x1771")) {
    return "Transaction failed due to slippage. Try increasing your buy amount or try again.";
  }

  return raw;
}
