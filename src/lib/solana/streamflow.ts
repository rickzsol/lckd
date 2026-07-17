import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  buildLockParams,
  ICluster,
  SolanaStreamClient,
  StreamType,
  type ICreateLinearStreamData,
} from "@streamflow/stream";
import BN from "bn.js";

const SECONDS_PER_DAY = 86_400;
const STREAM_NAME_MAX_BYTES = 64;
const VERIFY_MAX_RETRIES = 8;
const VERIFY_RETRY_DELAY_MS = 1_500;
const LOCK_SUBMISSION_BUFFER_SECONDS = 120;
const BLOCK_TIME_LOOKBACK_SLOTS = 5;

export interface StreamflowLockParams {
  sender: PublicKey;
  mint: PublicKey;
  amount: BN;
  durationSeconds: number;
  tokenName: string;
}

export interface StreamflowLockResult {
  instructions: TransactionInstruction[];
  metadataKeypair: {
    publicKey: PublicKey;
    secretKey: Uint8Array;
  };
  metadataId: string;
  unlockTimestamp: number;
  streamData: ICreateLinearStreamData;
  cluster: ICluster;
}

export interface VerifyStreamflowLockParams {
  connection: Connection;
  metadataId: string;
  sender: PublicKey;
  mint: PublicKey;
  amount: BN;
  unlockTimestamp: number;
}

function truncateUtf8(value: string, maxBytes: number): string {
  let result = "";
  let byteLength = 0;

  for (const character of value.trim()) {
    const characterBytes = new TextEncoder().encode(character).length;
    if (byteLength + characterBytes > maxBytes) break;
    result += character;
    byteLength += characterBytes;
  }

  return result || "Token lock";
}

function inferCluster(rpcEndpoint: string): ICluster {
  const endpoint = rpcEndpoint.toLowerCase();
  if (endpoint.includes("devnet")) return ICluster.Devnet;
  if (endpoint.includes("testnet")) return ICluster.Testnet;
  if (endpoint.includes("localhost") || endpoint.includes("127.0.0.1")) {
    return ICluster.Local;
  }
  return ICluster.Mainnet;
}

export function resolveStreamflowCluster(
  rpcEndpoint: string,
  configuredCluster = process.env.NEXT_PUBLIC_STREAMFLOW_CLUSTER,
): ICluster {
  const inferredCluster = inferCluster(rpcEndpoint);
  if (!configuredCluster) return inferredCluster;

  const supportedClusters = new Set<string>(Object.values(ICluster));
  if (!supportedClusters.has(configuredCluster)) {
    throw new Error(`Unsupported Streamflow cluster: ${configuredCluster}`);
  }

  const cluster = configuredCluster as ICluster;
  const endpointIdentifiesCluster = inferredCluster !== ICluster.Mainnet;
  if (endpointIdentifiesCluster && cluster !== inferredCluster) {
    throw new Error(
      `Streamflow cluster ${cluster} does not match RPC endpoint cluster ${inferredCluster}`,
    );
  }

  return cluster;
}

export function createStreamflowLockData(
  params: StreamflowLockParams,
  nowSeconds = Math.floor(Date.now() / 1000),
): { streamData: ICreateLinearStreamData; unlockTimestamp: number } {
  if (!Number.isSafeInteger(params.durationSeconds) || params.durationSeconds < 1) {
    throw new Error("Lock duration must be a positive whole number of seconds");
  }
  if (params.amount.ltn(1)) throw new Error("Lock amount must be positive");

  const unlockTimestamp = nowSeconds + params.durationSeconds;
  const streamData: ICreateLinearStreamData = {
    ...buildLockParams({
      recipient: params.sender.toBase58(),
      tokenId: params.mint.toBase58(),
      amount: params.amount,
      unlockDate: unlockTimestamp,
      name: truncateUtf8(params.tokenName, STREAM_NAME_MAX_BYTES),
      transferableByRecipient: false,
    }),
    canPause: false,
    canUpdateRate: false,
  };

  return { streamData, unlockTimestamp };
}

export async function getConfirmedClusterTimestamp(
  connection: Connection,
): Promise<number> {
  const currentSlot = await connection.getSlot("confirmed");
  for (let offset = 0; offset < BLOCK_TIME_LOOKBACK_SLOTS; offset += 1) {
    const blockTime = await connection.getBlockTime(currentSlot - offset);
    if (blockTime !== null && Number.isSafeInteger(blockTime) && blockTime > 0) {
      return blockTime;
    }
  }
  throw new Error("Unable to read Solana cluster time for the lock schedule");
}

export async function buildStreamflowLockInstructions(
  params: StreamflowLockParams,
  connection: Connection,
): Promise<StreamflowLockResult> {
  const cluster = resolveStreamflowCluster(connection.rpcEndpoint);
  const client = new SolanaStreamClient({
    clusterUrl: connection.rpcEndpoint,
    cluster,
    commitment: "confirmed",
  });
  const clusterTimestamp = await getConfirmedClusterTimestamp(connection);
  const { streamData, unlockTimestamp } = createStreamflowLockData(
    params,
    clusterTimestamp + LOCK_SUBMISSION_BUFFER_SECONDS,
  );
  const result = await client.buildCreateTransactionInstructions(streamData, {
    sender: { publicKey: params.sender },
    isNative: false,
    computePrice: 100_000,
    computeLimit: 400_000,
  });
  const latestClusterTimestamp = await getConfirmedClusterTimestamp(connection);
  if (unlockTimestamp < latestClusterTimestamp + params.durationSeconds) {
    throw new Error("Lock instruction build expired before wallet approval");
  }

  if (!result.metadata) {
    throw new Error("Streamflow did not return the required metadata signer");
  }
  if (result.metadata.publicKey.toBase58() !== result.metadataId) {
    throw new Error("Streamflow metadata signer does not match metadata ID");
  }

  return {
    instructions: result.ixs,
    metadataKeypair: {
      publicKey: result.metadata.publicKey,
      secretKey: result.metadata.secretKey,
    },
    metadataId: result.metadataId,
    unlockTimestamp,
    streamData,
    cluster,
  };
}

export async function getStreamflowTotalFeePercent(
  connection: Connection,
  sender: PublicKey,
): Promise<number> {
  const cluster = resolveStreamflowCluster(connection.rpcEndpoint);
  const client = new SolanaStreamClient({
    clusterUrl: connection.rpcEndpoint,
    cluster,
    commitment: "confirmed",
  });
  const feePercent = await client.getTotalFee({ address: sender.toBase58() });
  if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent >= 100) {
    throw new Error(`Streamflow returned an invalid fee: ${feePercent}`);
  }
  return feePercent;
}

export function calculateLockAmount(
  totalTokens: bigint,
  lockPercentage: number,
  totalFeePercent = 0.19,
): BN {
  if (totalTokens < BigInt(1)) throw new Error("Token balance must be positive");
  if (!Number.isInteger(lockPercentage) || lockPercentage < 1 || lockPercentage > 100) {
    throw new Error("Lock percentage must be a whole number between 1 and 100");
  }

  if (!Number.isFinite(totalFeePercent) || totalFeePercent < 0 || totalFeePercent >= 100) {
    throw new Error("Streamflow fee percentage is invalid");
  }

  const feePrecision = BigInt(1_000_000);
  const percentDenominator = BigInt(100) * feePrecision;
  const feeUnits = BigInt(Math.ceil(totalFeePercent * Number(feePrecision)));
  const lockAmount = (
    totalTokens * BigInt(lockPercentage) + BigInt(99)
  ) / BigInt(100);
  const totalDebit = (
    lockAmount * (percentDenominator + feeUnits) + percentDenominator - BigInt(1)
  ) / percentDenominator;
  if (totalDebit > totalTokens) {
    throw new Error("Selected lock percentage leaves insufficient tokens for Streamflow fees");
  }

  return new BN(lockAmount.toString());
}

export function lockDaysToSeconds(days: number): number {
  if (!Number.isSafeInteger(days) || days < 1) {
    throw new Error("Lock duration must be at least 1 whole day");
  }
  return days * SECONDS_PER_DAY;
}

/** Full-cliff acceptance mirroring the SDK's isCliffCloseToDepositedAmount:
 * cliffAmount within [depositedAmount - 1, depositedAmount] (finding 3-new). */
function isFullCliffAmount(cliffAmount: BN, depositedAmount: BN): boolean {
  if (cliffAmount.gt(depositedAmount)) return false;
  return cliffAmount.gte(depositedAmount.subn(1));
}

function assertVerifiedLock(
  stream: Awaited<ReturnType<SolanaStreamClient["getOne"]>>,
  expected: Omit<VerifyStreamflowLockParams, "connection" | "metadataId">,
): void {
  const sender = expected.sender.toBase58();
  if (stream.type !== StreamType.Lock) throw new Error("Contract is not a token lock");
  if (stream.sender !== sender || stream.recipient !== sender) {
    throw new Error("Lock sender or recipient does not match the wallet");
  }
  if (stream.mint !== expected.mint.toBase58()) throw new Error("Lock mint mismatch");
  if (!stream.depositedAmount.eq(expected.amount)) throw new Error("Lock amount mismatch");
  if (stream.start !== expected.unlockTimestamp || stream.cliff !== expected.unlockTimestamp) {
    throw new Error("Lock unlock timestamp mismatch");
  }
  if (stream.period !== 1 || !stream.amountPerPeriod.eqn(1)) {
    throw new Error("Lock release schedule mismatch");
  }
  // Canonical full cliff per the Streamflow SDK: cliffAmount within
  // [depositedAmount - 1, depositedAmount]. buildLockParams emits a one-unit
  // residual tail (amountPerPeriod 1), so the on-chain cliffAmount can be
  // depositedAmount - 1. Requiring strict equality wrongly rejects valid locks
  // (finding 3-new); the unlocked() assertions below prove the real schedule.
  if (!isFullCliffAmount(stream.cliffAmount, stream.depositedAmount)) {
    throw new Error("Lock does not release the full deposit at its cliff");
  }
  if (!stream.unlocked(expected.unlockTimestamp - 1).isZero()) {
    throw new Error("Lock releases tokens before the selected unlock timestamp");
  }
  if (!stream.unlocked(expected.unlockTimestamp).eq(stream.depositedAmount)) {
    throw new Error("Lock does not fully unlock at the selected timestamp");
  }
  if (stream.end - stream.cliff > 1) {
    throw new Error("Lock does not unlock within the required one-second window");
  }
  if (
    stream.canTopup ||
    stream.automaticWithdrawal ||
    stream.cancelableBySender ||
    stream.cancelableByRecipient ||
    stream.transferableBySender ||
    stream.transferableByRecipient
  ) {
    throw new Error("Lock permissions are not immutable");
  }
}

export async function verifyStreamflowLock(
  params: VerifyStreamflowLockParams,
): Promise<void> {
  const cluster = resolveStreamflowCluster(params.connection.rpcEndpoint);
  const client = new SolanaStreamClient({
    clusterUrl: params.connection.rpcEndpoint,
    cluster,
    commitment: "confirmed",
  });
  let lastError: unknown;

  for (let attempt = 0; attempt < VERIFY_MAX_RETRIES; attempt += 1) {
    try {
      const stream = await client.getOne({ id: params.metadataId });
      assertVerifiedLock(stream, params);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < VERIFY_MAX_RETRIES - 1) {
        await new Promise((resolve) => setTimeout(resolve, VERIFY_RETRY_DELAY_MS));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Unable to verify the Streamflow lock on-chain");
}
