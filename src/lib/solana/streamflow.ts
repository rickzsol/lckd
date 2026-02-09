import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  SolanaStreamClient,
  type ICreateLinearStreamData,
  type IPrepareCreateStreamExt,
  ICluster,
} from "@streamflow/stream";
import BN from "bn.js";

const SECONDS_PER_DAY = 86_400;
const STREAM_NAME_MAX_LENGTH = 64;

export interface StreamflowLockParams {
  /** Wallet creating and receiving the vesting lock (self-lock) */
  sender: PublicKey;
  /** Token mint address */
  mint: PublicKey;
  /** Total token amount to lock (in raw units, 6 decimals for pump.fun tokens) */
  amount: BN;
  /** Lock duration in seconds (tokens unlock all at once after this period) */
  durationSeconds: number;
  /** Token name used for the stream contract name */
  tokenName: string;
}

export interface StreamflowLockResult {
  instructions: TransactionInstruction[];
  /** The metadata keypair that must co-sign the transaction */
  metadataKeypair: {
    publicKey: PublicKey;
    secretKey: Uint8Array;
  } | null;
  metadataId: string;
}

/**
 * Builds Streamflow token lock instructions for a self-lock (sender = recipient).
 * All tokens locked until the cliff date, then released in full.
 * Non-cancelable, non-transferable — appears under "Locks" in Streamflow dashboard.
 *
 * Streamflow classifies a stream as a Lock (not Vesting) when:
 *   cliffAmount >= depositedAmount - 1
 * i.e., full amount unlocks at cliff in a lump sum.
 */
export async function buildStreamflowLockInstructions(
  params: StreamflowLockParams,
  connection: Connection,
): Promise<StreamflowLockResult> {
  const { sender, mint, amount, durationSeconds, tokenName } = params;

  if (durationSeconds <= 0) {
    throw new Error("Lock duration must be positive");
  }

  if (amount.isZero() || amount.isNeg()) {
    throw new Error("Lock amount must be positive");
  }

  const rpcUrl = connection.rpcEndpoint;
  const client = new SolanaStreamClient({
    clusterUrl: rpcUrl,
    cluster: ICluster.Mainnet,
  });

  // Buffer so the start time is still in the future when the tx lands on-chain.
  // 120s accounts for wallet signature approval time + network propagation.
  const startTime = Math.floor(Date.now() / 1000) + 120;

  // Cliff = unlock date. All tokens release at once.
  const cliffTime = startTime + durationSeconds;

  const streamName = tokenName
    .slice(0, STREAM_NAME_MAX_LENGTH)
    .padEnd(1, " ");

  // Token Lock config: cliffAmount = full amount, released at cliff date.
  // period/amountPerPeriod are required fields but irrelevant for locks
  // since cliffAmount covers the full deposit.
  const streamData: ICreateLinearStreamData = {
    recipient: sender.toBase58(),
    amount: amount,
    amountPerPeriod: amount,
    name: streamName,
    tokenId: mint.toBase58(),
    start: startTime,
    period: durationSeconds,
    cliff: cliffTime,
    cliffAmount: amount,
    cancelableBySender: false,
    cancelableByRecipient: false,
    transferableBySender: false,
    transferableByRecipient: false,
    canTopup: false,
    automaticWithdrawal: false,
    canPause: false,
    canUpdateRate: false,
  };

  const extParams: IPrepareCreateStreamExt = {
    sender: { publicKey: sender },
    isNative: false,
  };

  const result = await client.buildCreateTransactionInstructions(
    streamData,
    extParams,
  );

  return {
    instructions: result.ixs,
    metadataKeypair: result.metadata
      ? {
          publicKey: result.metadata.publicKey,
          secretKey: result.metadata.secretKey,
        }
      : null,
    metadataId: result.metadataId,
  };
}

/**
 * Streamflow charges a 0.19% service fee on top of the deposited amount.
 * When locking a percentage of the wallet balance, we must reduce the lock
 * amount so that lockAmount + fee <= available balance.
 */
const STREAMFLOW_FEE_BPS = 19; // 0.19% = 19 basis points

/**
 * Calculates the raw token amount to lock based on total tokens held
 * and the desired lock percentage, accounting for Streamflow's service fee.
 */
export function calculateLockAmount(
  totalTokens: bigint,
  lockPercentage: number,
): BN {
  if (lockPercentage < 1 || lockPercentage > 100) {
    throw new Error("Lock percentage must be between 1 and 100");
  }

  // Tokens the user wants to lock (before fee)
  const desired = (totalTokens * BigInt(lockPercentage)) / BigInt(100);

  // Streamflow transfers: lockAmount + (lockAmount * fee / 10000)
  // So max lockAmount = desired * 10000 / (10000 + feeBps)
  const locked = (desired * BigInt(10000)) / BigInt(10000 + STREAMFLOW_FEE_BPS);

  return new BN(locked.toString());
}

/**
 * Converts lock duration from days to seconds.
 */
export function lockDaysToSeconds(days: number): number {
  if (days <= 0) {
    throw new Error("Lock duration must be at least 1 day");
  }
  return days * SECONDS_PER_DAY;
}
