import {
  Connection,
  Keypair,
  Transaction,
  VersionedTransaction,
  ComputeBudgetProgram,
  PublicKey,
} from "@solana/web3.js";
import type { LaunchConfig } from "@/types/index";
import { uploadToIPFS, type TokenMetadataInput } from "./ipfs";
import {
  fetchPumpPortalCreateTx,
  estimateTokensFromSol,
} from "./pumpfun";
import {
  buildStreamflowLockInstructions,
  calculateLockAmount,
  lockDaysToSeconds,
} from "./streamflow";
import { getSupabase } from "@/lib/supabase";
import {
  DEFAULT_PRIORITY_FEE_MICROLAMPORTS,
  DEFAULT_PRIORITY_FEE_SOL,
} from "./constants";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LaunchStep {
  step: "ipfs" | "create" | "lock" | "record";
  status: "pending" | "active" | "done" | "error";
  message: string;
}

export interface LaunchResult {
  mintAddress: string;
  launchTxSignature: string;
  lockTxSignature: string;
  lockMetadataId: string;
  estimatedTokensAcquired: bigint;
}

export interface CreateTxBundle {
  /** Serialized transaction bytes from PumpPortal, needs signing */
  txBytes: Uint8Array;
  /** Mint keypair that must co-sign the create transaction */
  mintKeypair: Keypair;
}

export interface LockTxBundle {
  /** Assembled transaction with Streamflow lock instructions */
  transaction: Transaction;
  /** Additional signers required (Streamflow metadata keypair) */
  additionalSigners: Keypair[];
}

// ─── Step 1: IPFS Upload ─────────────────────────────────────────────────────

export async function prepareMetadata(
  config: LaunchConfig,
): Promise<string> {
  if (!config.image) {
    throw new Error("Token image is required");
  }

  const metadata: TokenMetadataInput = {
    name: config.name,
    symbol: config.ticker,
    description: config.description,
    twitter: config.twitterUrl ?? undefined,
    telegram: config.telegramUrl ?? undefined,
    website: config.websiteUrl ?? undefined,
  };

  return uploadToIPFS(config.image, metadata);
}

// ─── Step 2: Create + Buy Transaction ────────────────────────────────────────

/**
 * Builds the pump.fun create+buy transaction via PumpPortal's trade-local API.
 * Returns the raw transaction bytes and the mint keypair for signing.
 *
 * The caller (wallet adapter) must:
 *  1. Deserialize the VersionedTransaction from the bytes
 *  2. Sign with both the wallet AND the mintKeypair
 *  3. Send to an RPC endpoint
 */
export async function buildCreateTransaction(
  config: LaunchConfig,
  walletPublicKey: PublicKey,
  metadataUri: string,
): Promise<CreateTxBundle> {
  if (config.buyAmountSol <= 0) {
    throw new Error("Initial buy amount must be greater than 0 SOL");
  }

  const mintKeypair = Keypair.generate();

  const txBytes = await fetchPumpPortalCreateTx({
    creatorPublicKey: walletPublicKey.toBase58(),
    mintKeypair,
    name: config.name,
    symbol: config.ticker,
    metadataUri,
    buyAmountSol: config.buyAmountSol,
    priorityFeeSol: DEFAULT_PRIORITY_FEE_SOL,
  });

  return { txBytes, mintKeypair };
}

/**
 * Deserializes and co-signs the PumpPortal create transaction with the mint keypair.
 * Returns a VersionedTransaction that still needs the wallet's signature.
 */
export function prepareCreateTxForSigning(
  txBytes: Uint8Array,
  mintKeypair: Keypair,
): VersionedTransaction {
  const tx = VersionedTransaction.deserialize(txBytes);
  tx.sign([mintKeypair]);
  return tx;
}

// ─── Step 3: Streamflow Lock Transaction ─────────────────────────────────────

/**
 * Builds the Streamflow vesting lock transaction.
 *
 * This must be called AFTER the create+buy transaction confirms,
 * because Streamflow needs to read the token account balance.
 *
 * The lock is a self-lock: sender = recipient = wallet owner.
 * Linear vesting over the specified duration, non-cancelable.
 */
export async function buildLockTransaction(
  config: LaunchConfig,
  walletPublicKey: PublicKey,
  mintAddress: PublicKey,
  connection: Connection,
): Promise<LockTxBundle> {
  const durationSeconds = lockDaysToSeconds(config.lockDurationDays);
  const estimatedTokens = estimateTokensFromSol(config.buyAmountSol);
  const lockAmount = calculateLockAmount(estimatedTokens, config.lockPercentage);

  const lockResult = await buildStreamflowLockInstructions(
    {
      sender: walletPublicKey,
      mint: mintAddress,
      amount: lockAmount,
      durationSeconds,
      tokenName: config.name,
    },
    connection,
  );

  const transaction = new Transaction();

  // Priority fee for the lock transaction
  transaction.add(
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: DEFAULT_PRIORITY_FEE_MICROLAMPORTS,
    }),
  );

  // Streamflow suggests ~300K CU for stream creation
  transaction.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
  );

  for (const ix of lockResult.instructions) {
    transaction.add(ix);
  }

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = walletPublicKey;

  const additionalSigners: Keypair[] = [];
  if (lockResult.metadataKeypair) {
    const kp = Keypair.fromSecretKey(lockResult.metadataKeypair.secretKey);
    additionalSigners.push(kp);
    transaction.partialSign(kp);
  }

  return { transaction, additionalSigners };
}

// ─── Step 4: Record Launch to Supabase ───────────────────────────────────────

export interface RecordLaunchParams {
  mintAddress: string;
  name: string;
  ticker: string;
  description: string;
  imageUri: string;
  creatorWallet: string;
  launchTxSignature: string;
  lockTxSignature: string;
  lockDurationDays: number;
  lockPercentage: number;
  lockAmount: string;
  buyAmountSol: number;
  githubUsername: string | null;
  githubRepo: string | null;
  liveUrl: string | null;
  twitterUrl: string | null;
  telegramUrl: string | null;
  websiteUrl: string | null;
}

export async function recordLaunch(params: RecordLaunchParams): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase.from("tokens").insert({
    mint_address: params.mintAddress,
    name: params.name,
    ticker: params.ticker,
    description: params.description,
    image_uri: params.imageUri,
    creator_wallet: params.creatorWallet,
    launch_tx: params.launchTxSignature,
    lock_tx: params.lockTxSignature,
    lock_duration_days: params.lockDurationDays,
    lock_percentage: params.lockPercentage,
    lock_amount: params.lockAmount,
    buy_amount_sol: params.buyAmountSol,
    github_username: params.githubUsername,
    github_repo: params.githubRepo,
    live_url: params.liveUrl,
    twitter_url: params.twitterUrl,
    telegram_url: params.telegramUrl,
    website_url: params.websiteUrl,
    trust_tier: 1, // LOCKED - initial tier for all new launches
  });

  if (error) {
    throw new Error(`Failed to record launch in database: ${error.message}`);
  }
}

// ─── Full Launch Orchestrator ────────────────────────────────────────────────

/**
 * Orchestrates the full token launch flow:
 *  1. Upload image + metadata to IPFS
 *  2. Build pump.fun create+buy transaction (via PumpPortal)
 *  3. Return both transactions for the wallet adapter to sign and send
 *
 * The caller is responsible for:
 *  - Signing and sending the create transaction
 *  - Waiting for confirmation
 *  - Calling buildLockTransaction() with the confirmed mint
 *  - Signing and sending the lock transaction
 *  - Calling recordLaunch() after both confirm
 *
 * This separation exists because:
 *  - The wallet adapter handles signing (we can't access private keys)
 *  - The lock transaction depends on the create transaction confirming first
 *  - Transaction size limits prevent bundling all instructions into one tx
 *    (pump.fun create ~14 accounts + buy ~12 accounts + Streamflow ~17 accounts
 *     exceeds the 1232-byte transaction size limit)
 */
export async function prepareLaunch(
  config: LaunchConfig,
  walletPublicKey: PublicKey,
  onProgress?: (step: LaunchStep) => void,
): Promise<{
  metadataUri: string;
  createTxBundle: CreateTxBundle;
}> {
  // Validate inputs upfront
  validateLaunchConfig(config);

  // Step 1: Upload to IPFS
  onProgress?.({
    step: "ipfs",
    status: "active",
    message: "Uploading token metadata to IPFS...",
  });

  const metadataUri = await prepareMetadata(config);

  onProgress?.({
    step: "ipfs",
    status: "done",
    message: "Metadata uploaded successfully",
  });

  // Step 2: Build create+buy transaction
  onProgress?.({
    step: "create",
    status: "active",
    message: "Building token creation transaction...",
  });

  const createTxBundle = await buildCreateTransaction(
    config,
    walletPublicKey,
    metadataUri,
  );

  onProgress?.({
    step: "create",
    status: "done",
    message: `Token mint: ${createTxBundle.mintKeypair.publicKey.toBase58()}`,
  });

  return { metadataUri, createTxBundle };
}

// ─── Validation ──────────────────────────────────────────────────────────────

function validateLaunchConfig(config: LaunchConfig): void {
  if (!config.name || config.name.trim().length === 0) {
    throw new Error("Token name is required");
  }

  if (!config.ticker || config.ticker.trim().length === 0) {
    throw new Error("Token ticker is required");
  }

  if (config.ticker.length > 10) {
    throw new Error("Token ticker must be 10 characters or fewer");
  }

  if (!config.image) {
    throw new Error("Token image is required");
  }

  if (config.buyAmountSol <= 0) {
    throw new Error("Initial buy amount must be greater than 0 SOL");
  }

  if (config.lockDurationDays < 1) {
    throw new Error("Lock duration must be at least 1 day");
  }

  if (config.lockPercentage < 1 || config.lockPercentage > 100) {
    throw new Error("Lock percentage must be between 1 and 100");
  }
}
