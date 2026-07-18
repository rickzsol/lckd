import type { AllocationClassification } from "@/types";
import { readArray, readNumber, readString } from "./jsonRead";

// Classifies enhanced Helius transactions against tracked allocation
// wallets. Balances come from accountData.tokenBalanceChanges raw strings
// so pump.fun-scale amounts stay exact; tokenTransfers carries floats.

export interface MintTrackingContext {
  tokenId: string;
  mint: string;
  wallets: ReadonlySet<string>;
}

export interface ClassifiedMovement {
  tokenId: string;
  walletAddress: string;
  direction: "in" | "out";
  amount: string;
  counterpartyWallet: string | null;
  classification: AllocationClassification;
  source: string | null;
  signature: string;
  slot: number | null;
  blockTime: string | null;
}

const DEX_SOURCES = new Set([
  "RAYDIUM",
  "JUPITER",
  "ORCA",
  "METEORA",
  "PUMP_AMM",
  "PUMP_FUN",
  "PHOENIX",
  "LIFINITY",
  "OPENBOOK",
  "SERUM",
  "ALDRIN",
  "CREMA",
  "SABER",
  "MERCURIAL",
  "INVARIANT",
  "GOOSEFX",
  "DRIFT",
  "OKX",
]);

/** Net raw balance change per owner for one mint across the transaction. */
function collectOwnerDeltas(transaction: unknown, mint: string): Map<string, bigint> {
  const deltas = new Map<string, bigint>();
  for (const account of readArray(transaction, "accountData")) {
    for (const change of readArray(account, "tokenBalanceChanges")) {
      if (readString(change, "mint") !== mint) continue;
      const owner = readString(change, "userAccount");
      const rawAmount = Reflect.get(change as object, "rawTokenAmount");
      const amount = readString(rawAmount, "tokenAmount");
      if (!owner || !amount || !/^-?\d+$/.test(amount)) continue;
      deltas.set(owner, (deltas.get(owner) ?? BigInt(0)) + BigInt(amount));
    }
  }
  return deltas;
}

export function findCounterparty(
  deltas: Map<string, bigint>,
  wallet: string,
  walletDelta: bigint,
): string | null {
  let counterparty: string | null = null;
  let largestOpposite = BigInt(0);
  for (const [owner, delta] of deltas) {
    if (owner === wallet) continue;
    const isOpposite = walletDelta < BigInt(0) ? delta > BigInt(0) : delta < BigInt(0);
    if (!isOpposite) continue;
    const magnitude = delta < BigInt(0) ? -delta : delta;
    if (magnitude > largestOpposite) {
      largestOpposite = magnitude;
      counterparty = owner;
    }
  }
  return counterparty;
}

function classifyOutflow(
  type: string | null,
  source: string | null,
  counterparty: string | null,
  trackedWallets: ReadonlySet<string>,
): AllocationClassification {
  if (type?.startsWith("BURN")) return "burned";
  if (type === "SWAP" || (source !== null && DEX_SOURCES.has(source))) return "sold";
  if (counterparty && trackedWallets.has(counterparty)) return "internal";
  if (!counterparty) return "unknown";
  return "distributed";
}

/**
 * Extract every movement touching a tracked wallet from one enhanced
 * transaction. A transaction can move several tracked mints and several
 * tracked wallets at once; each (wallet, mint) pairing yields one row.
 */
export function classifyEnhancedTransaction(
  transaction: unknown,
  contexts: readonly MintTrackingContext[],
): ClassifiedMovement[] {
  const signature = readString(transaction, "signature");
  if (!signature) return [];

  const slot = readNumber(transaction, "slot");
  const timestamp = readNumber(transaction, "timestamp");
  const blockTime = timestamp === null
    ? null
    : new Date(timestamp * 1_000).toISOString();
  const type = readString(transaction, "type");
  const source = readString(transaction, "source");

  const movements: ClassifiedMovement[] = [];
  for (const context of contexts) {
    const deltas = collectOwnerDeltas(transaction, context.mint);
    for (const wallet of context.wallets) {
      const delta = deltas.get(wallet);
      if (delta === undefined || delta === BigInt(0)) continue;

      const isOutflow = delta < BigInt(0);
      const counterparty = findCounterparty(deltas, wallet, delta);
      const classification = isOutflow
        ? classifyOutflow(type, source, counterparty, context.wallets)
        : counterparty && context.wallets.has(counterparty)
          ? "internal"
          : "received";

      movements.push({
        tokenId: context.tokenId,
        walletAddress: wallet,
        direction: isOutflow ? "out" : "in",
        amount: (isOutflow ? -delta : delta).toString(),
        counterpartyWallet: counterparty,
        classification,
        source,
        signature,
        slot,
        blockTime,
      });
    }
  }
  return movements;
}
