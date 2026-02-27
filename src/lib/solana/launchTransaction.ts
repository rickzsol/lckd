import {
  Connection,
  Keypair,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
  ComputeBudgetProgram,
  PublicKey,
} from "@solana/web3.js";
import type { LaunchConfig } from "@/types/index";
import { uploadToIPFS, type TokenMetadataInput } from "./ipfs";
import { estimateTokensFromSol, fetchPumpPortalCreateTx } from "./pumpfun";
import {
  buildStreamflowLockInstructions,
  calculateLockAmount,
  lockDaysToSeconds,
} from "./streamflow";
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
}

export interface LockTxBundle {
  /** Assembled transaction with Streamflow lock instructions */
  transaction: Transaction;
  /** Additional signers required (Streamflow metadata keypair) */
  additionalSigners: Keypair[];
  /** Actual number of tokens locked (raw amount as string) */
  lockAmount: string;
}

export interface PrebuiltLockInstructions {
  /** Raw Streamflow + compute budget instructions (no blockhash) */
  instructions: TransactionInstruction[];
  /** Streamflow metadata keypair that must co-sign */
  additionalSigners: Keypair[];
  /** Lock amount in raw token units */
  lockAmount: string;
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
  mintPublicKey: PublicKey,
  metadataUri: string,
): Promise<CreateTxBundle> {
  if (config.buyAmountSol <= 0) {
    throw new Error("Initial buy amount must be greater than 0 SOL");
  }

  const txBytes = await fetchPumpPortalCreateTx({
    creatorPublicKey: walletPublicKey.toBase58(),
    mintPublicKey: mintPublicKey.toBase58(),
    name: config.name,
    symbol: config.ticker,
    metadataUri,
    buyAmountSol: config.buyAmountSol,
    priorityFeeSol: DEFAULT_PRIORITY_FEE_SOL,
  });

  return { txBytes };
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
 * Builds the Streamflow token lock transaction.
 *
 * This must be called AFTER the create+buy transaction confirms,
 * because Streamflow needs to read the token account balance.
 *
 * The lock is a self-lock: sender = recipient = wallet owner.
 * Tokens unlock in full at the end of the lock period, non-cancelable.
 */
export async function buildLockTransaction(
  config: LaunchConfig,
  walletPublicKey: PublicKey,
  mintAddress: PublicKey,
  connection: Connection,
): Promise<LockTxBundle> {
  const durationSeconds = lockDaysToSeconds(config.lockDurationDays);

  // Query actual token balance with retry — the RPC may not have indexed
  // the token account immediately after the create tx confirms.
  const { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = await import("@solana/spl-token");

  const BALANCE_MAX_RETRIES = 10;
  const BALANCE_RETRY_DELAY_MS = 1500;

  let actualBalance = BigInt(0);
  for (let attempt = 0; attempt < BALANCE_MAX_RETRIES; attempt++) {
    for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      try {
        const ata = await getAssociatedTokenAddress(mintAddress, walletPublicKey, false, programId);
        const info = await connection.getTokenAccountBalance(ata);
        actualBalance = BigInt(info.value.amount);
        if (actualBalance > BigInt(0)) break;
      } catch {
        // Account doesn't exist under this program — try next
      }
    }
    if (actualBalance > BigInt(0)) break;
    if (attempt < BALANCE_MAX_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, BALANCE_RETRY_DELAY_MS));
    }
  }

  if (actualBalance === BigInt(0)) {
    throw new Error("No tokens found in wallet after multiple attempts. The create transaction may not have landed yet — please retry.");
  }

  const lockAmount = calculateLockAmount(actualBalance, config.lockPercentage);

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

  // Streamflow stream creation can use up to ~400K CU on mainnet
  transaction.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
  );

  for (const ix of lockResult.instructions) {
    transaction.add(ix);
  }

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = walletPublicKey;

  // Do NOT partialSign here — wallet adapters can re-serialize the transaction
  // and drop existing partial signatures. The caller must sign with these
  // keypairs AFTER the wallet signs.
  const additionalSigners: Keypair[] = [];
  if (lockResult.metadataKeypair) {
    additionalSigners.push(Keypair.fromSecretKey(lockResult.metadataKeypair.secretKey));
  }

  return { transaction, additionalSigners, lockAmount: lockAmount.toString() };
}

// ─── Step 3b: Pre-build Lock Instructions (estimate-based, no polling) ───────

/**
 * Pre-builds Streamflow lock instructions using an estimated token balance
 * derived from the bonding curve math. Called in parallel with create TX
 * confirmation so there's zero wait after the create confirms.
 *
 * Uses a 2% safety margin on the estimate to ensure we never try to lock
 * more tokens than actually received. The ~2% dust stays in wallet.
 */
export async function prebuildLockInstructions(
  config: LaunchConfig,
  walletPublicKey: PublicKey,
  mintAddress: PublicKey,
  connection: Connection,
): Promise<PrebuiltLockInstructions> {
  const durationSeconds = lockDaysToSeconds(config.lockDurationDays);

  const estimatedTokens = estimateTokensFromSol(config.buyAmountSol);
  // 2% safety margin — never lock more than received
  const safeEstimate = (estimatedTokens * BigInt(98)) / BigInt(100);
  const lockAmount = calculateLockAmount(safeEstimate, config.lockPercentage);

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

  const instructions: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: DEFAULT_PRIORITY_FEE_MICROLAMPORTS,
    }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ...lockResult.instructions,
  ];

  const additionalSigners: Keypair[] = [];
  if (lockResult.metadataKeypair) {
    additionalSigners.push(
      Keypair.fromSecretKey(lockResult.metadataKeypair.secretKey),
    );
  }

  return {
    instructions,
    additionalSigners,
    lockAmount: lockAmount.toString(),
  };
}

/**
 * Assembles a ready-to-sign Transaction from pre-built instructions with a
 * **fresh** blockhash. Call this immediately before requesting wallet signature
 * to minimize the time between blockhash fetch and TX landing.
 */
export async function assembleLockTransaction(
  prebuilt: PrebuiltLockInstructions,
  walletPublicKey: PublicKey,
  connection: Connection,
): Promise<LockTxBundle> {
  const transaction = new Transaction();
  for (const ix of prebuilt.instructions) {
    transaction.add(ix);
  }

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = walletPublicKey;

  return {
    transaction,
    additionalSigners: prebuilt.additionalSigners,
    lockAmount: prebuilt.lockAmount,
  };
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
  mintPublicKey: PublicKey,
  onProgress?: (step: LaunchStep) => void,
): Promise<{
  metadataUri: string;
  createTxBundle: CreateTxBundle;
}> {
  validateLaunchConfig(config);

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

  onProgress?.({
    step: "create",
    status: "active",
    message: "Building token creation transaction...",
  });

  const createTxBundle = await buildCreateTransaction(
    config,
    walletPublicKey,
    mintPublicKey,
    metadataUri,
  );

  onProgress?.({
    step: "create",
    status: "done",
    message: `Token mint: ${mintPublicKey.toBase58()}`,
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
