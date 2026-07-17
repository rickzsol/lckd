import {
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  getAbiItem,
  type Hash,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { PONS_FACTORY_ABI, PONS_FACTORY_ADDRESS } from "@/lib/evm/pons";
import {
  RobinhoodRecoveryError,
  assertRobinhoodTransactionMatches,
  type NormalizedRobinhoodIntent,
} from "./robinhoodLaunchRecoverySchema";

export const ROBINHOOD_REQUIRED_CONFIRMATIONS = BigInt(20);
export const ROBINHOOD_LOG_SCAN_CHUNK_BLOCKS = BigInt(10_000);
export const ROBINHOOD_MAX_SCAN_BLOCKS_PER_REQUEST = BigInt(100_000);
export const ROBINHOOD_INTENT_LIFETIME_BLOCKS = BigInt(7_000_000);
export const ROBINHOOD_RECOVERY_POLICY = {
  requiredConfirmations: ROBINHOOD_REQUIRED_CONFIRMATIONS,
  logScanChunkBlocks: ROBINHOOD_LOG_SCAN_CHUNK_BLOCKS,
  maxScanBlocksPerRequest: ROBINHOOD_MAX_SCAN_BLOCKS_PER_REQUEST,
  intentLifetimeBlocks: ROBINHOOD_INTENT_LIFETIME_BLOCKS,
} as const;

export type KnownTransactionState = "missing" | "pending" | "success" | "reverted" | "mismatch";

export interface KnownTransactionResult {
  state: KnownTransactionState;
  hash: Hash;
  receipt?: TransactionReceipt;
}

export type CheckpointTransactionState = "missing" | "exact" | "mismatch";

export interface LaunchCandidate {
  hash: Hash;
  receipt: TransactionReceipt;
}

export interface LaunchScanResult {
  candidate: LaunchCandidate | null;
  scannedThrough: bigint;
  isComplete: boolean;
}

const TOKEN_LAUNCHED_EVENT = getAbiItem({ abi: PONS_FACTORY_ABI, name: "TokenLaunched" });

function isNotFound(error: unknown): boolean {
  return error instanceof TransactionNotFoundError || error instanceof TransactionReceiptNotFoundError;
}

async function assertExactTransaction(
  publicClient: PublicClient,
  hash: Hash,
  intent: NormalizedRobinhoodIntent,
) {
  const transaction = await publicClient.getTransaction({ hash });
  assertRobinhoodTransactionMatches({
    chainId: transaction.chainId ?? await publicClient.getChainId(),
    from: transaction.from,
    to: transaction.to,
    value: transaction.value,
    input: transaction.input,
  }, intent);
}

export async function inspectKnownTransaction(
  publicClient: PublicClient,
  hash: Hash,
  intent: NormalizedRobinhoodIntent,
): Promise<KnownTransactionResult> {
  try {
    await assertExactTransaction(publicClient, hash, intent);
  } catch (error) {
    if (isNotFound(error)) return { state: "missing", hash };
    if (error instanceof RobinhoodRecoveryError && error.status === 422) return { state: "mismatch", hash };
    throw error;
  }
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash });
    return { state: receipt.status === "success" ? "success" : "reverted", hash, receipt };
  } catch (error) {
    if (isNotFound(error)) return { state: "pending", hash };
    throw error;
  }
}

export async function prevalidateCheckpointTransaction(
  publicClient: PublicClient,
  hash: Hash,
  intent: NormalizedRobinhoodIntent,
): Promise<CheckpointTransactionState> {
  try {
    await assertExactTransaction(publicClient, hash, intent);
    return "exact";
  } catch (error) {
    if (error instanceof TransactionNotFoundError) return "missing";
    if (error instanceof RobinhoodRecoveryError && error.status === 422) return "mismatch";
    throw error;
  }
}

async function exactCandidate(
  publicClient: PublicClient,
  hash: Hash,
  intent: NormalizedRobinhoodIntent,
): Promise<LaunchCandidate | null> {
  try {
    await assertExactTransaction(publicClient, hash, intent);
  } catch (error) {
    if (error instanceof RobinhoodRecoveryError && error.status === 422) return null;
    throw error;
  }
  const receipt = await publicClient.getTransactionReceipt({ hash });
  if (receipt.status !== "success") return null;
  return { hash, receipt };
}

function minimum(...values: bigint[]): bigint {
  return values.reduce((smallest, value) => value < smallest ? value : smallest);
}

export async function scanForExactLaunch(
  publicClient: PublicClient,
  intent: NormalizedRobinhoodIntent,
  preparedBlock: bigint,
  lastScannedBlock: bigint,
  latestBlock: bigint,
): Promise<LaunchScanResult> {
  const lifetimeEnd = preparedBlock + ROBINHOOD_INTENT_LIFETIME_BLOCKS;
  const scanLimit = minimum(latestBlock, lifetimeEnd);
  const fromBlock = lastScannedBlock < preparedBlock ? preparedBlock : lastScannedBlock + BigInt(1);
  if (fromBlock > scanLimit) return { candidate: null, scannedThrough: lastScannedBlock, isComplete: true };
  const requestEnd = minimum(
    scanLimit,
    fromBlock + ROBINHOOD_MAX_SCAN_BLOCKS_PER_REQUEST - BigInt(1),
  );
  let cursor = fromBlock;
  while (cursor <= requestEnd) {
    const toBlock = minimum(requestEnd, cursor + ROBINHOOD_LOG_SCAN_CHUNK_BLOCKS - BigInt(1));
    const logs = await publicClient.getLogs({
      address: PONS_FACTORY_ADDRESS,
      event: TOKEN_LAUNCHED_EVENT,
      args: { deployer: intent.walletAddress },
      fromBlock: cursor,
      toBlock,
    });
    for (const log of logs) {
      const candidate = await exactCandidate(publicClient, log.transactionHash, intent);
      if (candidate) return { candidate, scannedThrough: toBlock, isComplete: true };
    }
    cursor = toBlock + BigInt(1);
  }
  return {
    candidate: null,
    scannedThrough: requestEnd,
    isComplete: requestEnd >= scanLimit,
  };
}

export function hasRequiredConfirmations(latestBlock: bigint, receiptBlock: bigint): boolean {
  if (receiptBlock > latestBlock) return false;
  return latestBlock - receiptBlock + BigInt(1) >= ROBINHOOD_REQUIRED_CONFIRMATIONS;
}

export function shouldFailAfterReplacementScan(
  state: KnownTransactionState,
  isScanComplete: boolean,
  hasReplacement: boolean,
): boolean {
  return isScanComplete && !hasReplacement && (state === "reverted" || state === "mismatch");
}
