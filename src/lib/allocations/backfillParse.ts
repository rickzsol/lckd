import { PublicKey } from "@solana/web3.js";
import { findCounterparty, type ClassifiedMovement } from "./classify";
import type { AllocationClassification } from "@/types";
import { readArray, readNumber, readObject, readString } from "./jsonRead";

// Repair path for movements the webhook missed. Parsed RPC transactions
// carry no Helius type/source tags, so classification is conservative:
// burns and internal moves are certain, plain wallet-to-wallet transfers
// classify by curve check, and anything program-mediated stays unknown
// rather than guessing sold versus distributed.

export interface BackfillContext {
  tokenId: string;
  mint: string;
  wallet: string;
  trackedWallets: ReadonlySet<string>;
}

function ownerDeltasFromBalances(
  meta: unknown,
  mint: string,
): Map<string, bigint> {
  const deltas = new Map<string, bigint>();
  const apply = (entries: unknown[], sign: bigint) => {
    for (const entry of entries) {
      if (readString(entry, "mint") !== mint) continue;
      const owner = readString(entry, "owner");
      const amount = readString(readObject(entry, "uiTokenAmount"), "amount");
      if (!owner || !amount || !/^\d+$/.test(amount)) continue;
      deltas.set(owner, (deltas.get(owner) ?? BigInt(0)) + sign * BigInt(amount));
    }
  };
  apply(readArray(meta, "preTokenBalances"), BigInt(-1));
  apply(readArray(meta, "postTokenBalances"), BigInt(1));
  return deltas;
}

function hasBurnInstruction(transaction: unknown, meta: unknown, mint: string): boolean {
  const message = readObject(readObject(transaction, "transaction"), "message");
  const instructionGroups = [
    readArray(message, "instructions"),
    ...readArray(meta, "innerInstructions").map((group) =>
      readArray(group, "instructions"),
    ),
  ];
  for (const instructions of instructionGroups) {
    for (const instruction of instructions) {
      const parsed = readObject(instruction, "parsed");
      const type = readString(parsed, "type");
      if (type !== "burn" && type !== "burnChecked") continue;
      if (readString(readObject(parsed, "info"), "mint") === mint) return true;
    }
  }
  return false;
}

function isOnCurveAddress(address: string): boolean {
  try {
    return PublicKey.isOnCurve(new PublicKey(address).toBytes());
  } catch {
    return false;
  }
}

export function movementFromParsedTransaction(
  transaction: unknown,
  signature: string,
  context: BackfillContext,
): ClassifiedMovement | null {
  const meta = readObject(transaction, "meta");
  if (!meta || Reflect.get(meta, "err")) return null;

  const deltas = ownerDeltasFromBalances(meta, context.mint);
  const delta = deltas.get(context.wallet);
  if (delta === undefined || delta === BigInt(0)) return null;

  const isOutflow = delta < BigInt(0);
  const counterparty = findCounterparty(deltas, context.wallet, delta);

  let classification: AllocationClassification;
  if (isOutflow && hasBurnInstruction(transaction, meta, context.mint)) {
    classification = "burned";
  } else if (counterparty && context.trackedWallets.has(counterparty)) {
    classification = "internal";
  } else if (counterparty && isOnCurveAddress(counterparty)) {
    classification = isOutflow ? "distributed" : "received";
  } else {
    classification = "unknown";
  }

  const blockTime = readNumber(transaction, "blockTime");
  return {
    tokenId: context.tokenId,
    walletAddress: context.wallet,
    direction: isOutflow ? "out" : "in",
    amount: (isOutflow ? -delta : delta).toString(),
    counterpartyWallet: counterparty,
    classification,
    source: null,
    signature,
    slot: readNumber(transaction, "slot"),
    blockTime: blockTime === null ? null : new Date(blockTime * 1_000).toISOString(),
  };
}
