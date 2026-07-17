import "server-only";

import {
  getBuyTokenAmountFromSolAmount,
  OnlinePumpSdk,
  PUMP_SDK,
} from "@pump-fun/pump-sdk";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import type { LaunchConfig } from "@/types/index";
import {
  DEFAULT_PRIORITY_FEE_MICROLAMPORTS,
  DEFAULT_SLIPPAGE_BPS,
  LAMPORTS_PER_SOL,
} from "./constants";
import { pumpCreateExpectation } from "./launchTransaction";
import { validatePumpPortalCreateTransaction } from "./transactionValidation";

const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const CREATE_COMPUTE_UNIT_LIMIT = 220_000;
const FEE_RECIPIENT = new PublicKey("62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV");
const BUYBACK_FEE_RECIPIENT = new PublicKey(
  "5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD",
);

export interface CreateTxBundle {
  txBytes: Uint8Array;
}

let connectionPromise: Promise<Connection> | null = null;

async function getConnection(): Promise<Connection> {
  const rpcUrl = process.env.HELIUS_RPC_URL ?? (
    process.env.NODE_ENV === "production"
      ? undefined
      : process.env.NEXT_PUBLIC_HELIUS_RPC_URL
  );
  if (!rpcUrl) throw new Error("Pump transaction construction is unavailable");

  if (!connectionPromise) {
    connectionPromise = (async () => {
      const connection = new Connection(rpcUrl, "confirmed");
      if (
        process.env.NODE_ENV === "production" &&
        await connection.getGenesisHash() !== MAINNET_GENESIS_HASH
      ) {
        throw new Error("Pump transaction construction cluster mismatch");
      }
      return connection;
    })().catch((error) => {
      connectionPromise = null;
      throw error;
    });
  }
  return connectionPromise;
}

function solToLamports(solAmount: number): number {
  const lamports = Math.round(solAmount * LAMPORTS_PER_SOL);
  if (!Number.isSafeInteger(lamports) || lamports <= 0) {
    throw new Error("Initial buy amount must be greater than 0 SOL");
  }
  return lamports;
}

export async function buildCreateTransaction(
  config: LaunchConfig,
  walletPublicKey: PublicKey,
  mintPublicKey: PublicKey,
  metadataUri: string,
): Promise<CreateTxBundle> {
  const connection = await getConnection();
  const onlineSdk = new OnlinePumpSdk(connection);
  const [global, feeConfig, latestBlockhash] = await Promise.all([
    onlineSdk.fetchGlobal(),
    onlineSdk.fetchFeeConfig(),
    connection.getLatestBlockhash("confirmed"),
  ]);
  const buyAmount = new BN(solToLamports(config.buyAmountSol));
  const tokenAmount = getBuyTokenAmountFromSolAmount({
    global,
    feeConfig,
    mintSupply: null,
    bondingCurve: null,
    amount: buyAmount,
    quoteMint: NATIVE_MINT,
  });
  if (tokenAmount.lten(0)) throw new Error("Initial buy would receive no tokens");

  const maxQuoteAmount = buyAmount
    .muln(10_000 + DEFAULT_SLIPPAGE_BPS)
    .addn(9_999)
    .divn(10_000);
  const associatedUser = getAssociatedTokenAddressSync(
    mintPublicKey,
    walletPublicKey,
    false,
    TOKEN_PROGRAM_ID,
  );
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: CREATE_COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: DEFAULT_PRIORITY_FEE_MICROLAMPORTS,
    }),
    await PUMP_SDK.createInstruction({
      mint: mintPublicKey,
      name: config.name,
      symbol: config.ticker,
      uri: metadataUri,
      creator: walletPublicKey,
      user: walletPublicKey,
    }),
    createAssociatedTokenAccountIdempotentInstruction(
      walletPublicKey,
      associatedUser,
      walletPublicKey,
      mintPublicKey,
      TOKEN_PROGRAM_ID,
    ),
    await PUMP_SDK.getBuyInstructionRaw({
      user: walletPublicKey,
      mint: mintPublicKey,
      creator: walletPublicKey,
      amount: tokenAmount,
      solAmount: maxQuoteAmount,
      feeRecipient: FEE_RECIPIENT,
      buybackFeeRecipient: BUYBACK_FEE_RECIPIENT,
      tokenProgram: TOKEN_PROGRAM_ID,
    }),
  ];
  const message = new TransactionMessage({
    payerKey: walletPublicKey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions,
  }).compileToV0Message();
  const txBytes = new VersionedTransaction(message).serialize();
  validatePumpPortalCreateTransaction(
    txBytes,
    walletPublicKey,
    mintPublicKey,
    pumpCreateExpectation(config, metadataUri),
  );
  return { txBytes };
}
