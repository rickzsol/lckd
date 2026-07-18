import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  getAccount,
  getAssociatedTokenAddress,
  getMint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { LaunchConfig } from "@/types/index";
import {
  buildStreamflowLockInstructions,
  calculateLockAmount,
  getStreamflowTotalFeePercent,
  lockDaysToSeconds,
} from "./streamflow";
import {
  DEFAULT_PRIORITY_FEE_SOL,
  DEFAULT_SLIPPAGE_BPS,
  PUMPFUN_TOKEN_DECIMALS,
} from "./constants";
import {
  validatePumpPortalCreateTransaction,
  validateStreamflowLockTransaction,
} from "./transactionValidation";

const BALANCE_MAX_RETRIES = 10;
const BALANCE_RETRY_DELAY_MS = 1_500;

export interface LockTxBundle {
  transaction: Transaction;
  additionalSigners: Keypair[];
  lockAmount: string;
  metadataId: string;
  unlockTimestamp: number;
  blockhash: string;
  lastValidBlockHeight: number;
}

export function pumpCreateExpectation(config: LaunchConfig, metadataUri: string) {
  return {
    name: config.name,
    symbol: config.ticker,
    metadataUri,
    buyAmountSol: config.buyAmountSol,
    slippagePercent: DEFAULT_SLIPPAGE_BPS / 100,
    priorityFeeSol: DEFAULT_PRIORITY_FEE_SOL,
  };
}

export function prepareCreateTxForSigning(
  txBytes: Uint8Array,
  walletPublicKey: PublicKey,
  mintKeypair: Keypair,
  recentBlockhash: string,
  config: LaunchConfig,
  metadataUri: string,
): VersionedTransaction {
  const transaction = validatePumpPortalCreateTransaction(
    txBytes,
    walletPublicKey,
    mintKeypair.publicKey,
    pumpCreateExpectation(config, metadataUri),
  );
  transaction.message.recentBlockhash = recentBlockhash;
  transaction.sign([mintKeypair]);
  return transaction;
}

async function readPumpTokenBalance(
  connection: Connection,
  wallet: PublicKey,
  mint: PublicKey,
): Promise<{ amount: bigint; tokenProgram: PublicKey } | null> {
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    try {
      const mintInfo = await getMint(connection, mint, "confirmed", programId);
      if (mintInfo.decimals !== PUMPFUN_TOKEN_DECIMALS) {
        throw new Error(
          `Expected ${PUMPFUN_TOKEN_DECIMALS} mint decimals, received ${mintInfo.decimals}`,
        );
      }

      const tokenAccountAddress = await getAssociatedTokenAddress(
        mint,
        wallet,
        false,
        programId,
      );
      const tokenAccount = await getAccount(
        connection,
        tokenAccountAddress,
        "confirmed",
        programId,
      );
      if (!tokenAccount.owner.equals(wallet) || !tokenAccount.mint.equals(mint)) {
        throw new Error("Token account owner or mint mismatch");
      }
      return { amount: tokenAccount.amount, tokenProgram: programId };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Expected ")) throw error;
    }
  }
  return null;
}

async function waitForPumpTokenBalance(
  connection: Connection,
  wallet: PublicKey,
  mint: PublicKey,
): Promise<{ amount: bigint; tokenProgram: PublicKey }> {
  for (let attempt = 0; attempt < BALANCE_MAX_RETRIES; attempt += 1) {
    const balance = await readPumpTokenBalance(connection, wallet, mint);
    if (balance && balance.amount > BigInt(0)) return balance;
    if (attempt < BALANCE_MAX_RETRIES - 1) {
      await new Promise((resolve) => setTimeout(resolve, BALANCE_RETRY_DELAY_MS));
    }
  }
  throw new Error("No pump.fun tokens found after the create transaction confirmed");
}

export async function buildLockTransaction(
  config: LaunchConfig,
  walletPublicKey: PublicKey,
  mintAddress: PublicKey,
  connection: Connection,
): Promise<LockTxBundle> {
  const durationSeconds = lockDaysToSeconds(config.lockDurationDays);
  const tokenBalance = await waitForPumpTokenBalance(
    connection,
    walletPublicKey,
    mintAddress,
  );
  const totalFeePercent = await getStreamflowTotalFeePercent(connection, walletPublicKey);
  const lockAmount = calculateLockAmount(
    tokenBalance.amount,
    config.lockPercentage,
    totalFeePercent,
  );
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

  const transaction = new Transaction().add(...lockResult.instructions);
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = walletPublicKey;

  const metadataSigner = Keypair.fromSecretKey(
    lockResult.metadataKeypair.secretKey,
  );
  validateStreamflowLockTransaction(
    transaction,
    walletPublicKey,
    mintAddress,
    metadataSigner.publicKey,
    lockResult.cluster,
    tokenBalance.tokenProgram,
    lockAmount,
    lockResult.unlockTimestamp,
  );

  return {
    transaction,
    additionalSigners: [metadataSigner],
    lockAmount: lockAmount.toString(),
    metadataId: lockResult.metadataId,
    unlockTimestamp: lockResult.unlockTimestamp,
    blockhash,
    lastValidBlockHeight,
  };
}
