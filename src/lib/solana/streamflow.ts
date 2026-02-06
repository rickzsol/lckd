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
  /** Vesting duration in seconds */
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
 * Builds Streamflow vesting lock instructions for a self-lock (sender = recipient).
 * Linear vesting, non-cancelable, non-transferable, no cliff, specified duration.
 *
 * The returned instructions can be appended to an existing transaction.
 * If a metadata keypair is returned, it must be included as an additional signer.
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

  const nowSeconds = Math.floor(Date.now() / 1000);

  // Linear vesting: distribute `amount` evenly over the duration.
  // period = 1 second for smooth linear unlock. amountPerPeriod = amount / duration.
  const period = 1;
  const amountPerPeriod = amount.div(new BN(durationSeconds));

  // If amount doesn't divide evenly, the remainder is implicitly handled by
  // Streamflow's contract (last period gets the remainder).
  const streamName = tokenName
    .slice(0, STREAM_NAME_MAX_LENGTH)
    .padEnd(1, " ");

  const streamData: ICreateLinearStreamData = {
    recipient: sender.toBase58(),
    amount: amount,
    amountPerPeriod: amountPerPeriod,
    name: streamName,
    tokenId: mint.toBase58(),
    start: nowSeconds,
    period: period,
    cliff: nowSeconds, // no cliff: set to start time
    cliffAmount: new BN(0),
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
 * Calculates the raw token amount to lock based on total tokens held
 * and the desired lock percentage.
 */
export function calculateLockAmount(
  totalTokens: bigint,
  lockPercentage: number,
): BN {
  if (lockPercentage < 1 || lockPercentage > 100) {
    throw new Error("Lock percentage must be between 1 and 100");
  }

  // Use integer math: (total * percentage) / 100
  const locked = (totalTokens * BigInt(lockPercentage)) / BigInt(100);
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
