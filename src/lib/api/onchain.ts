import "server-only";

import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ExtensionType,
  getAssociatedTokenAddressSync,
  getExtensionTypes,
  getMint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PUMP_CREATE_DISCRIMINATOR,
  PUMP_CREATE_V2_DISCRIMINATOR,
  type PumpCreateData,
  validatePumpCreateInstruction,
} from "@/lib/solana/pumpCreateValidation";
import { validatePumpBuyInstruction } from "@/lib/solana/pumpBuyValidation";
import {
  parsePumpTradeEvent,
  type VerifiedPumpTradeEvent,
} from "@/lib/solana/pumpTradeEvent";

const PUMPFUN_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const DEFAULT_STREAMFLOW_PROGRAM_ID = "strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m";
const STREAMFLOW_TREASURY = new PublicKey("5SEpbdjFK5FxwTvfsGMXVQTD2v4M2c5tyRTxhdsPkgDw");
const STREAMFLOW_WITHDRAWOR = new PublicKey("wdrwhnCv4pzW8beKsbPa4S2UDZrXenjg16KJdKSpb5u");
const STREAMFLOW_MAINNET_FEE_ORACLE = new PublicKey("B743wFVk2pCYhV91cn287e1xY7f1vt4gdY48hhNiuQmT");
const STREAMFLOW_NON_MAINNET_FEE_ORACLE = new PublicKey("Aa2JJfFzUN3V54DXUHRBJowFw416xfZHpPk9DaNy3iYs");
const CREATE_DISCRIMINATOR = PUMP_CREATE_DISCRIMINATOR;
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const SECONDS_PER_DAY = BigInt(86_400);
const FINALITY_ATTEMPTS = 6;
const FINALITY_RETRY_MS = 1_500;
const PUMPFUN_TOKEN_DECIMALS = 6;
const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const SAFE_TOKEN_2022_EXTENSIONS = new Set([
  ExtensionType.MetadataPointer,
  ExtensionType.TokenMetadata,
]);

interface RawInstruction {
  programId: PublicKey;
  accounts?: PublicKey[];
  data?: string;
}

interface VerifiedLock {
  amount: string;
  debitedAmount: string;
  durationDays: number;
  percentage: number;
  unlockAt: string;
}

interface VerifiedLaunch {
  purchasedAmount: bigint;
  name: string;
  symbol: string;
  metadataUri: string;
  buyAmountLamports: bigint;
}

interface TransactionTokenBalance {
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
}

export class OnChainVerificationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

let connectionPromise: Promise<Connection> | null = null;

async function getConnection(): Promise<Connection> {
  const rpcUrl = process.env.HELIUS_RPC_URL ?? (
    process.env.NODE_ENV === "production"
      ? undefined
      : process.env.NEXT_PUBLIC_HELIUS_RPC_URL
  );
  if (!rpcUrl) {
    throw new OnChainVerificationError("On-chain verification is unavailable", 503);
  }

  if (!connectionPromise) {
    connectionPromise = (async () => {
      const connection = new Connection(rpcUrl, {
        commitment: "finalized",
        confirmTransactionInitialTimeout: 15_000,
      });
      if (
        process.env.NODE_ENV === "production" &&
        await connection.getGenesisHash() !== MAINNET_GENESIS_HASH
      ) {
        throw new OnChainVerificationError("On-chain verification cluster mismatch", 503);
      }
      return connection;
    })().catch((error) => {
      connectionPromise = null;
      throw error;
    });
  }
  return connectionPromise;
}

function decodeBase58(value: string): Buffer {
  let decoded = BigInt(0);
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) throw new OnChainVerificationError("Invalid transaction data", 422);
    decoded = decoded * BigInt(58) + BigInt(digit);
  }

  let hex = decoded.toString(16);
  if (hex.length % 2 !== 0) hex = `0${hex}`;
  const bytes = decoded === BigInt(0) ? Buffer.alloc(0) : Buffer.from(hex, "hex");
  const leadingZeroes = value.match(/^1*/)?.[0].length ?? 0;
  return Buffer.concat([Buffer.alloc(leadingZeroes), bytes]);
}

function assertFinalizedTransaction(
  transaction: Awaited<ReturnType<Connection["getParsedTransaction"]>>,
  walletAddress: string,
  mintAddress: string,
) {
  if (!transaction) {
    throw new OnChainVerificationError("Transaction is not finalized", 409);
  }
  if (transaction.meta?.err) {
    throw new OnChainVerificationError("Transaction failed on-chain", 422);
  }

  const accounts = transaction.transaction.message.accountKeys;
  const hasWalletSigner = accounts.some(
    (account) => account.signer && account.pubkey.toBase58() === walletAddress,
  );
  const hasMint = accounts.some((account) => account.pubkey.toBase58() === mintAddress);

  if (!hasWalletSigner || !hasMint) {
    throw new OnChainVerificationError("Transaction does not belong to the linked wallet and mint", 403);
  }

  return transaction;
}

async function getFinalizedTransaction(
  signature: string,
  walletAddress: string,
  mintAddress: string,
) {
  if (!SIGNATURE_PATTERN.test(signature)) {
    throw new OnChainVerificationError("Invalid transaction signature", 400);
  }

  const connection = await getConnection();
  let transaction: Awaited<ReturnType<Connection["getParsedTransaction"]>> = null;

  for (let attempt = 0; attempt < FINALITY_ATTEMPTS; attempt++) {
    transaction = await connection.getParsedTransaction(signature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });
    if (transaction) break;
    if (attempt < FINALITY_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, FINALITY_RETRY_MS));
    }
  }

  return assertFinalizedTransaction(transaction, walletAddress, mintAddress);
}

export async function verifyFinalizedLaunchTransaction(
  signature: string,
  walletAddress: string,
  mintAddress: string,
): Promise<VerifiedLaunch> {
  const transaction = await getFinalizedTransaction(signature, walletAddress, mintAddress);
  const accountKeys = transaction.transaction.message.accountKeys;
  const mintAccount = accountKeys.find(
    (account) => account.pubkey.toBase58() === mintAddress,
  );
  const wallet = new PublicKey(walletAddress);
  const mintPublicKey = new PublicKey(mintAddress);
  const signers = accountKeys.filter((account) => account.signer).map((account) => account.pubkey);
  const hasExactSigners =
    signers.length === 2 &&
    signers.some((account) => account.equals(wallet)) &&
    signers.some((account) => account.equals(mintPublicKey));
  if (!accountKeys[0]?.pubkey.equals(wallet) || !mintAccount?.signer || !hasExactSigners) {
    throw new OnChainVerificationError("Transaction is not a verified pump.fun launch", 422);
  }

  const allowedPrograms = new Set([
    ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
    ComputeBudgetProgram.programId.toBase58(),
    PUMPFUN_PROGRAM_ID,
  ]);
  let createData: PumpCreateData | null = null;
  let maxBuyAmountLamports: bigint | null = null;
  const outerInstructions = transaction.transaction.message.instructions as RawInstruction[];
  try {
    for (const instruction of outerInstructions) {
      const programId = instruction.programId.toBase58();
      if (!allowedPrograms.has(programId)) {
        throw new Error(`Unapproved outer program ${programId}`);
      }
      if (programId !== PUMPFUN_PROGRAM_ID) continue;
      if (!instruction.data || !instruction.accounts) {
        throw new Error("Pump instruction is not inspectable");
      }
      const data = decodeBase58(instruction.data);
      const discriminator = data.subarray(0, 8).toString("hex");
      if (
        discriminator === PUMP_CREATE_DISCRIMINATOR ||
        discriminator === PUMP_CREATE_V2_DISCRIMINATOR
      ) {
        if (createData || maxBuyAmountLamports !== null) {
          throw new Error("Unexpected Pump create order");
        }
        createData = validatePumpCreateInstruction(
          data,
          instruction.accounts,
          wallet,
          mintPublicKey,
        );
        continue;
      }
      if (!createData || maxBuyAmountLamports !== null) {
        throw new Error("Unexpected Pump buy order");
      }
      maxBuyAmountLamports = validatePumpBuyInstruction(
        data,
        instruction.accounts,
        wallet,
        mintPublicKey,
        createData,
      );
    }
  } catch (error) {
    throw new OnChainVerificationError(
      error instanceof Error ? error.message : "Launch instruction validation failed",
      422,
    );
  }
  if (!createData || maxBuyAmountLamports === null) {
    throw new OnChainVerificationError("Transaction must contain one exact Pump create and buy", 422);
  }

  let tradeEvent: VerifiedPumpTradeEvent | null = null;
  try {
    for (const instruction of (transaction.meta?.innerInstructions ?? []).flatMap(
      (group) => group.instructions as RawInstruction[],
    )) {
      if (instruction.programId.toBase58() !== PUMPFUN_PROGRAM_ID || !instruction.data) continue;
      const parsedEvent = parsePumpTradeEvent(decodeBase58(instruction.data));
      if (!parsedEvent) continue;
      if (tradeEvent) throw new Error("Launch contains multiple Pump trade events");
      tradeEvent = parsedEvent;
    }
  } catch (error) {
    throw new OnChainVerificationError(
      error instanceof Error ? error.message : "Pump trade event validation failed",
      422,
    );
  }
  if (
    !tradeEvent ||
    !tradeEvent.mint.equals(mintPublicKey) ||
    !tradeEvent.user.equals(wallet) ||
    tradeEvent.totalSolAmount <= BigInt(0) ||
    tradeEvent.totalSolAmount > maxBuyAmountLamports
  ) {
    throw new OnChainVerificationError("Finalized Pump purchase event is invalid", 422);
  }

  const connection = await getConnection();
  const account = await connection.getAccountInfo(mintPublicKey, "finalized");
  if (
    !account ||
    (!account.owner.equals(TOKEN_PROGRAM_ID) && !account.owner.equals(TOKEN_2022_PROGRAM_ID))
  ) {
    throw new OnChainVerificationError("Launch mint uses an unsupported token program", 422);
  }
  const mint = await getMint(connection, mintPublicKey, "finalized", account.owner);
  if (
    !mint.isInitialized ||
    mint.decimals !== PUMPFUN_TOKEN_DECIMALS ||
    mint.supply <= BigInt(0) ||
    mint.mintAuthority !== null ||
    mint.freezeAuthority !== null
  ) {
    throw new OnChainVerificationError("Launch mint authorities or decimals are unsafe", 422);
  }
  if (
    account.owner.equals(TOKEN_2022_PROGRAM_ID) &&
    getExtensionTypes(mint.tlvData).some((extension) => !SAFE_TOKEN_2022_EXTENSIONS.has(extension))
  ) {
    throw new OnChainVerificationError("Launch mint has unsupported Token-2022 extensions", 422);
  }

  const preBalance = sumWalletMintBalances(
    transaction.meta?.preTokenBalances,
    walletAddress,
    mintAddress,
  );
  const postBalance = sumWalletMintBalances(
    transaction.meta?.postTokenBalances,
    walletAddress,
    mintAddress,
  );
  const purchasedAmount = postBalance - preBalance;
  if (purchasedAmount <= BigInt(0)) {
    throw new OnChainVerificationError("Launch transaction has no verified token purchase", 422);
  }
  if (tradeEvent.tokenAmount !== purchasedAmount) {
    throw new OnChainVerificationError("Finalized Pump purchase amount is inconsistent", 422);
  }

  return {
    purchasedAmount,
    name: createData.name,
    symbol: createData.symbol,
    metadataUri: createData.metadataUri,
    buyAmountLamports: tradeEvent.totalSolAmount,
  };
}

function parseVerifiedStreamflowLock(
  instruction: RawInstruction,
  blockTime: number | null | undefined,
): Omit<VerifiedLock, "percentage" | "debitedAmount"> {
  const data = instruction.data ? decodeBase58(instruction.data) : Buffer.alloc(0);
  if (
    data.length !== 148 ||
    data.subarray(0, 8).toString("hex") !== CREATE_DISCRIMINATOR
  ) {
    throw new OnChainVerificationError("Transaction is not a Streamflow lock creation", 422);
  }

  const start = data.readBigUInt64LE(8);
  const amount = data.readBigUInt64LE(16);
  const period = data.readBigUInt64LE(24);
  const amountPerPeriod = data.readBigUInt64LE(32);
  const cliff = data.readBigUInt64LE(40);
  const cliffAmount = data.readBigUInt64LE(48);
  const withdrawalFrequency = data.readBigUInt64LE(126);
  const tokenLockFlags = [56, 57, 58, 59, 60, 61];
  const hasTokenLockFlags = tokenLockFlags.every((offset) => data[offset] === 0);
  const canPause = data[135];
  const canUpdateRate = data[137];
  const hasImmutableOptionEncoding =
    data[134] === 1 &&
    canPause === 0 &&
    data[136] === 1 &&
    canUpdateRate === 0 &&
    data.subarray(138).every((value) => value === 0);
  if (!blockTime || cliff <= BigInt(blockTime)) {
    throw new OnChainVerificationError("Unable to verify the Streamflow unlock time", 422);
  }

  const durationSeconds = cliff - BigInt(blockTime);
  const durationDays = durationSeconds / SECONDS_PER_DAY;

  if (
    amount < BigInt(1) ||
    start !== cliff ||
    period !== BigInt(1) ||
    amountPerPeriod !== BigInt(1) ||
    cliffAmount !== amount ||
    withdrawalFrequency !== period ||
    !hasImmutableOptionEncoding ||
    durationSeconds < SECONDS_PER_DAY ||
    !hasTokenLockFlags
  ) {
    throw new OnChainVerificationError("Streamflow transaction is not a non-cancelable token lock", 422);
  }

  return {
    amount: amount.toString(),
    durationDays: Number(durationDays),
    unlockAt: new Date(Number(cliff) * 1_000).toISOString(),
  };
}

function sumWalletMintBalances(
  balances: TransactionTokenBalance[] | null | undefined,
  walletAddress: string,
  mintAddress: string,
): bigint {
  return (balances ?? [])
    .filter((balance) => balance.owner === walletAddress && balance.mint === mintAddress)
    .reduce((total, balance) => total + BigInt(balance.uiTokenAmount.amount), BigInt(0));
}

export async function verifyFinalizedLockTransaction(
  signature: string,
  walletAddress: string,
  mintAddress: string,
  launchPurchasedAmount: bigint,
): Promise<VerifiedLock> {
  if (launchPurchasedAmount <= BigInt(0)) {
    throw new OnChainVerificationError("Launch purchase amount is invalid", 422);
  }
  const transaction = await getFinalizedTransaction(signature, walletAddress, mintAddress);
  const streamflowProgramId = process.env.NODE_ENV === "production"
    ? DEFAULT_STREAMFLOW_PROGRAM_ID
    : process.env.STREAMFLOW_PROGRAM_ID?.trim() || DEFAULT_STREAMFLOW_PROGRAM_ID;
  const streamflowProgram = new PublicKey(streamflowProgramId);
  const outerInstructions = transaction.transaction.message.instructions as RawInstruction[];
  const expectedComputePrice = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 100_000,
  }).data;
  const expectedComputeLimit = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }).data;
  const hasExpectedComputeInstruction = (
    instruction: RawInstruction | undefined,
    expectedData: Buffer,
  ) =>
    instruction?.programId.equals(ComputeBudgetProgram.programId) &&
    Boolean(instruction.data) &&
    decodeBase58(instruction.data ?? "").equals(expectedData);
  if (
    outerInstructions.length !== 3 ||
    !hasExpectedComputeInstruction(outerInstructions[0], expectedComputePrice) ||
    !hasExpectedComputeInstruction(outerInstructions[1], expectedComputeLimit) ||
    !outerInstructions[2]?.programId.equals(streamflowProgram)
  ) {
    throw new OnChainVerificationError("Transaction is not the exact reviewed Streamflow lock", 422);
  }
  const instruction = outerInstructions[2];
  const accounts = instruction?.accounts?.map((account) => account.toBase58()) ?? [];
  const tokenProgram = accounts[15] ? new PublicKey(accounts[15]) : null;
  if (
    !tokenProgram ||
    (!tokenProgram.equals(TOKEN_PROGRAM_ID) && !tokenProgram.equals(TOKEN_2022_PROGRAM_ID))
  ) {
    throw new OnChainVerificationError("Streamflow lock uses an unsupported token program", 422);
  }
  const wallet = new PublicKey(walletAddress);
  const mint = new PublicKey(mintAddress);
  const metadata = accounts[3] ? new PublicKey(accounts[3]) : null;
  if (!metadata) {
    throw new OnChainVerificationError("Streamflow metadata account is missing", 422);
  }
  const walletAta = getAssociatedTokenAddressSync(mint, wallet, false, tokenProgram);
  const treasuryAta = getAssociatedTokenAddressSync(
    mint,
    STREAMFLOW_TREASURY,
    false,
    tokenProgram,
  );
  const [escrow] = PublicKey.findProgramAddressSync(
    [Buffer.from("strm"), metadata.toBuffer()],
    streamflowProgram,
  );
  const feeOracle = streamflowProgramId === DEFAULT_STREAMFLOW_PROGRAM_ID
    ? STREAMFLOW_MAINNET_FEE_ORACLE
    : STREAMFLOW_NON_MAINNET_FEE_ORACLE;
  const expectedAccounts = [
    wallet,
    walletAta,
    wallet,
    metadata,
    escrow,
    walletAta,
    STREAMFLOW_TREASURY,
    treasuryAta,
    STREAMFLOW_WITHDRAWOR,
    wallet,
    walletAta,
    mint,
    feeOracle,
    SYSVAR_RENT_PUBKEY,
    streamflowProgram,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    SystemProgram.programId,
  ].map((account) => account.toBase58());
  const metadataSigner = transaction.transaction.message.accountKeys.find(
    (account) => account.pubkey.equals(metadata),
  );
  if (
    accounts.length !== expectedAccounts.length ||
    accounts.some((account, index) => account !== expectedAccounts[index]) ||
    !metadataSigner?.signer
  ) {
    throw new OnChainVerificationError("Streamflow lock account layout is invalid", 422);
  }

  const lock = parseVerifiedStreamflowLock(instruction, transaction.blockTime);
  const preBalance = sumWalletMintBalances(
    transaction.meta?.preTokenBalances,
    walletAddress,
    mintAddress,
  );
  const postBalance = sumWalletMintBalances(
    transaction.meta?.postTokenBalances,
    walletAddress,
    mintAddress,
  );
  const tokenDebit = preBalance - postBalance;
  if (
    tokenDebit <= BigInt(0) ||
    tokenDebit > launchPurchasedAmount ||
    BigInt(lock.amount) > tokenDebit
  ) {
    throw new OnChainVerificationError("Unable to verify the locked token amount", 422);
  }

  const percentage = Number(
    (BigInt(lock.amount) * BigInt(1_000_000)) / launchPurchasedAmount,
  ) / 10_000;
  if (percentage < 1 || percentage > 100) {
    throw new OnChainVerificationError("Invalid verified lock percentage", 422);
  }

  return { ...lock, percentage, debitedAmount: tokenDebit.toString() };
}
