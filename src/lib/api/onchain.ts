import "server-only";

import { createHash } from "node:crypto";
import { isValidSolanaAddress } from "@/lib/api/validation";
import {
  assertLaunchFeeTerms,
  LCKD_MINT_ADDRESS,
  type LaunchFeeTerms,
} from "@/lib/solana/launchFee";
import {
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ExtensionType,
  getAssociatedTokenAddressSync,
  getExtensionTypes,
  getMint,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PUMP_AMM_EVENT_AUTHORITY_PDA,
  PUMP_AMM_PROGRAM_ID,
} from "@pump-fun/pump-swap-sdk";
import {
  ICluster,
  SolanaStreamClient,
  StreamType,
} from "@streamflow/stream";
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
import {
  BUYBACK_BURN_LAMPORTS,
  BUYBACK_BURN_PROGRAM_ID,
  LCKD_MINT,
  PUMP_BUY_EXACT_QUOTE_IN_ACCOUNT_COUNT,
  deriveBuybackBurnAtas,
  deriveBuybackBurnAuthority,
  validatePumpBuyExactQuoteInInstruction,
  wrapBuybackBurnInstruction,
} from "@/lib/solana/buybackBurn";

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
const ATOMIC_COMPUTE_UNIT_LIMIT = 400_000;
const ATOMIC_COMPUTE_UNIT_PRICE = 100_000;
const ATOMIC_OUTER_INSTRUCTION_COUNT = 7;
const PUMP_EXACT_TOKEN_BUY_DISCRIMINATOR = "66063d1201daebea";
const LOCK_COVERAGE_TOLERANCE = BigInt(10);
const BUYBACK_BURN_FEE_INSTRUCTION_INDEX = 6;
const NO_LOCK_MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const NO_LOCK_MEMO = Buffer.from("lckd:no-lock:v1", "utf8");
const PUMP_BUY_EXACT_QUOTE_IN_WRITABLE_INDEXES = new Set([0, 1, 5, 6, 7, 8, 10, 17, 20, 25]);
const PUMP_BUY_EVENT_CPI_PREFIX = Buffer.from(
  "e445a52e51cb9a1d67f4521f2cf57777",
  "hex",
);
const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const SAFE_TOKEN_2022_EXTENSIONS = new Set([
  ExtensionType.MetadataPointer,
  ExtensionType.TokenMetadata,
]);

interface RawInstruction {
  programId: PublicKey;
  accounts?: PublicKey[];
  data?: string;
  parsed?: { type?: string; info?: Record<string, unknown> };
  stackHeight?: number | null;
}

interface RawInnerInstructionGroup {
  index: number;
  instructions: RawInstruction[];
}

interface AtomicAccountKey {
  pubkey: PublicKey;
  signer: boolean;
  writable: boolean;
}

export interface VerifiedLock {
  amount: string;
  debitedAmount: string;
  durationDays: number;
  percentage: number;
  unlockAt: string;
}

export interface VerifiedLaunch {
  purchasedAmount: bigint;
  name: string;
  symbol: string;
  metadataUri: string;
  buyAmountLamports: bigint;
}

interface TransactionTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
}

export interface VerifiedBuybackBurnReceipt {
  burnedRawAmount: bigint;
  protocolLookupAddresses: readonly string[];
}

export interface AtomicLaunchExpectation {
  hasLock?: boolean;
  name: string;
  symbol: string;
  metadataUri: string;
  buyAmountSol: number;
  quotedTokenAmount: string;
  maxQuoteAmount: string;
  lookupTableAddress: string;
  lookupTableAddresses: readonly string[];
  lockAmount: string;
  unlockTimestamp: number;
  lockDurationDays: number;
  lockPercentage: number;
  fee: LaunchFeeTerms;
  issuedAtomicTransaction?: string;
  issuedAtomicMessageHash?: string;
}

export interface VerifiedAtomicLaunch extends VerifiedLaunch {
  signature: string;
  executedAt: string;
  metadataAddress: string;
  lookupTableAddress: string;
  walletDelta: string;
  walletFinalBalance: string;
  escrowBalance: string;
  burnedLckdRawAmount: string | null;
  lock: VerifiedLock | null;
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

export async function getFinalizedBlockHeight(): Promise<number> {
  return (await getConnection()).getBlockHeight("finalized");
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

function assertAtomicExpectation(expectation: AtomicLaunchExpectation): void {
  const hasLock = expectation.hasLock !== false;
  if (
    !expectation.name ||
    Buffer.byteLength(expectation.name, "utf8") > 64 ||
    !expectation.symbol ||
    !expectation.metadataUri ||
    !Number.isFinite(expectation.buyAmountSol) ||
    expectation.buyAmountSol < 0.01 ||
    expectation.buyAmountSol > 100 ||
    !/^\d+$/.test(expectation.quotedTokenAmount) ||
    BigInt(expectation.quotedTokenAmount) <= BigInt(0) ||
    !/^\d+$/.test(expectation.maxQuoteAmount) ||
    BigInt(expectation.maxQuoteAmount) <= BigInt(0) ||
    expectation.lookupTableAddresses.length < 1 ||
    expectation.lookupTableAddresses.some((address) => {
      try {
        new PublicKey(address);
        return false;
      } catch {
        return true;
      }
    }) ||
    expectation.lockAmount.length > 20 ||
    !/^\d+$/.test(expectation.lockAmount) ||
    (hasLock
      ? BigInt(expectation.lockAmount) < BigInt(1)
      : BigInt(expectation.lockAmount) !== BigInt(0)) ||
    BigInt(expectation.lockAmount) > BigInt("18446744073709551615") ||
    !Number.isSafeInteger(expectation.unlockTimestamp) ||
    (hasLock
      ? !Number.isInteger(expectation.lockDurationDays) ||
        expectation.lockDurationDays < 1 ||
        !Number.isInteger(expectation.lockPercentage) ||
        expectation.lockPercentage < 51 ||
        expectation.lockPercentage > 99
      : expectation.unlockTimestamp !== 0)
  ) {
    throw new OnChainVerificationError("Atomic launch expectation is invalid", 422);
  }
  if (
    expectation.fee.feeMode === "buybackBurn" &&
    (typeof expectation.issuedAtomicTransaction !== "string" ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(expectation.issuedAtomicTransaction) ||
      !/^[0-9a-f]{64}$/.test(expectation.issuedAtomicMessageHash ?? ""))
  ) {
    throw new OnChainVerificationError("Atomic buyback issuance proof is invalid", 422);
  }
}

function assertExactAtomicSigners(
  transaction: NonNullable<Awaited<ReturnType<Connection["getParsedTransaction"]>>>,
  wallet: PublicKey,
  mint: PublicKey,
  metadata: PublicKey,
  signature: string,
): void {
  const accountKeys = transaction.transaction.message.accountKeys;
  const signers = accountKeys.filter((account) => account.signer).map((account) => account.pubkey);
  const expectedSigners = [wallet, mint, metadata];
  if (
    transaction.version !== 0 ||
    !transaction.meta ||
    transaction.meta.err !== null ||
    transaction.transaction.signatures.length !== expectedSigners.length ||
    transaction.transaction.signatures[0] !== signature ||
    signers.length !== expectedSigners.length ||
    !accountKeys[0]?.pubkey.equals(wallet) ||
    expectedSigners.some((expected) => {
      const account = accountKeys.find((candidate) => candidate.pubkey.equals(expected));
      return !account?.signer || !account.writable;
    }) ||
    expectedSigners.some((expected) => !signers.some((signer) => signer.equals(expected)))
  ) {
    throw new OnChainVerificationError("Transaction is not the exact atomic launch", 422);
  }
}

function assertNoUnusedAtomicAccounts(
  transaction: NonNullable<Awaited<ReturnType<Connection["getParsedTransaction"]>>>,
): void {
  const instructions = transaction.transaction.message.instructions as RawInstruction[];
  const usedAccounts = new Set<string>();
  // jsonParsed instructions (ATA create, ALT deactivate) carry their accounts
  // inside parsed.info instead of an accounts array, so collect both forms.
  const collectParsedAddresses = (value: unknown): void => {
    if (typeof value === "string" && isValidSolanaAddress(value)) {
      usedAccounts.add(value);
    } else if (Array.isArray(value)) {
      value.forEach(collectParsedAddresses);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(collectParsedAddresses);
    }
  };
  for (const instruction of instructions) {
    usedAccounts.add(instruction.programId.toBase58());
    for (const account of instruction.accounts ?? []) usedAccounts.add(account.toBase58());
    collectParsedAddresses((instruction as { parsed?: unknown }).parsed);
  }
  if (
    transaction.transaction.message.accountKeys.some(
      (account) => !usedAccounts.has(account.pubkey.toBase58()),
    )
  ) {
    throw new OnChainVerificationError("Atomic launch contains unused transaction accounts", 422);
  }
}

async function assertFinalizedAtomicLookupTable(
  connection: Connection,
  lookupTable: PublicKey,
  wallet: PublicKey,
  expectedAddresses: readonly string[],
  expectedDeactivated = true,
): Promise<void> {
  const { value } = await connection.getAddressLookupTable(lookupTable, {
    commitment: "finalized",
  });
  const isDeactivated = value?.state.deactivationSlot !== BigInt("18446744073709551615");
  if (
    !value ||
    !value.state.authority?.equals(wallet) ||
    isDeactivated !== expectedDeactivated ||
    value.state.addresses.length !== expectedAddresses.length ||
    value.state.addresses.some(
      (address, index) => address.toBase58() !== expectedAddresses[index],
    )
  ) {
    throw new OnChainVerificationError("Finalized atomic lookup table state is invalid", 422);
  }
}

async function verifyBuybackIssuance(params: {
  connection: Connection;
  signature: string;
  lookupTable: PublicKey;
  expectation: AtomicLaunchExpectation;
}): Promise<{ protocolLookupTable: PublicKey; protocolLookupAddresses: readonly string[] }> {
  let issued: VersionedTransaction;
  try {
    issued = VersionedTransaction.deserialize(
      Buffer.from(params.expectation.issuedAtomicTransaction!, "base64"),
    );
  } catch {
    throw new OnChainVerificationError("Atomic buyback issuance transaction is invalid", 422);
  }
  const issuedMessage = issued.message.serialize();
  const issuedHash = createHash("sha256").update(issuedMessage).digest("hex");
  const lookups = issued.message.addressTableLookups;
  if (
    issuedHash !== params.expectation.issuedAtomicMessageHash ||
    lookups.length !== 2 ||
    !lookups[0]?.accountKey.equals(params.lookupTable)
  ) {
    throw new OnChainVerificationError("Atomic buyback issuance lookup tables are invalid", 422);
  }
  const issuedProtocolLookup = lookups[1];
  const finalized = await params.connection.getTransaction(params.signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  if (
    !finalized || finalized.meta?.err ||
    !Buffer.from(finalized.transaction.message.serialize()).equals(Buffer.from(issuedMessage))
  ) {
    throw new OnChainVerificationError("Finalized buyback message does not match issuance", 422);
  }
  const { value } = await params.connection.getAddressLookupTable(issuedProtocolLookup.accountKey, {
    commitment: "finalized",
  });
  if (!value || value.state.deactivationSlot !== BigInt("18446744073709551615")) {
    throw new OnChainVerificationError("Buyback protocol lookup table is invalid", 422);
  }
  const referencedIndexes = [
    ...issuedProtocolLookup.writableIndexes,
    ...issuedProtocolLookup.readonlyIndexes,
  ];
  const issuedAddressCount = Math.max(...referencedIndexes) + 1;
  if (
    referencedIndexes.length === 0 ||
    issuedAddressCount > value.state.addresses.length
  ) {
    throw new OnChainVerificationError("Buyback protocol lookup table no longer resolves", 422);
  }
  return {
    protocolLookupTable: issuedProtocolLookup.accountKey,
    // Lookup tables are append-only. Freeze the prefix addressable by the
    // immutable issued message so later extensions cannot invalidate receipts.
    protocolLookupAddresses: value.state.addresses
      .slice(0, issuedAddressCount)
      .map((address) => address.toBase58()),
  };
}

function assertAtomicLookupTables(
  transaction: NonNullable<Awaited<ReturnType<Connection["getParsedTransaction"]>>>,
  expected: readonly {
    lookupTable: PublicKey;
    addresses: readonly string[];
    requireAllAddresses: boolean;
  }[],
): void {
  const lookups = transaction.transaction.message.addressTableLookups ?? [];
  const loadedAddresses = transaction.transaction.message.accountKeys
    .filter((account) => account.source === "lookupTable")
    .map((account) => account.pubkey.toBase58());
  const resolveIndexes = (kind: "writableIndexes" | "readonlyIndexes") =>
    lookups.flatMap((lookup, tableIndex) => lookup[kind].map((addressIndex) => {
      const address = expected[tableIndex]?.addresses[addressIndex];
      if (!address) {
        throw new OnChainVerificationError("Atomic launch lookup index is invalid", 422);
      }
      return address;
    }));
  const expectedLoaded = [
    ...resolveIndexes("writableIndexes"),
    ...resolveIndexes("readonlyIndexes"),
  ];
  if (
    lookups.length !== expected.length ||
    lookups.some((lookup, index) => !lookup.accountKey.equals(expected[index].lookupTable)) ||
    loadedAddresses.length !== expectedLoaded.length ||
    loadedAddresses.some((address, index) => address !== expectedLoaded[index]) ||
    expected.some((table, index) => table.requireAllAddresses &&
      lookups[index].writableIndexes.length + lookups[index].readonlyIndexes.length !==
        table.addresses.length)
  ) {
    throw new OnChainVerificationError("Atomic launch must use the reviewed address lookup tables", 422);
  }
}

function instructionHasData(instruction: RawInstruction, expectedData: Buffer): boolean {
  return Boolean(instruction.data) && decodeBase58(instruction.data ?? "").equals(expectedData);
}

function assertAtomicAtaInstruction(
  instruction: RawInstruction,
  wallet: PublicKey,
  mint: PublicKey,
): void {
  // jsonParsed decodes this instruction, so the account vector arrives as
  // parsed.info fields instead of a raw accounts array.
  const info = instruction.parsed?.info ?? {};
  const walletAta = getAssociatedTokenAddressSync(mint, wallet, false, TOKEN_PROGRAM_ID);
  if (
    !instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID) ||
    instruction.parsed?.type !== "createIdempotent" ||
    info.source !== wallet.toBase58() ||
    info.account !== walletAta.toBase58() ||
    info.wallet !== wallet.toBase58() ||
    info.mint !== mint.toBase58() ||
    info.systemProgram !== SystemProgram.programId.toBase58() ||
    info.tokenProgram !== TOKEN_PROGRAM_ID.toBase58()
  ) {
    throw new OnChainVerificationError("Atomic launch wallet token account is invalid", 422);
  }
}

function assertAtomicFeeInstruction(
  instruction: RawInstruction | undefined,
  wallet: PublicKey,
  fee: LaunchFeeTerms,
): void {
  const info = instruction?.parsed?.info ?? {};
  if (fee.feeMode === "burnLckd") {
    const walletLckdAta = getAssociatedTokenAddressSync(
      new PublicKey(LCKD_MINT_ADDRESS),
      wallet,
      false,
      TOKEN_PROGRAM_ID,
    );
    if (
      !instruction?.programId.equals(TOKEN_PROGRAM_ID) ||
      instruction.parsed?.type !== "burn" ||
      info.account !== walletLckdAta.toBase58() ||
      info.mint !== LCKD_MINT_ADDRESS ||
      info.authority !== wallet.toBase58() ||
      info.amount !== fee.feeLckdRaw
    ) {
      throw new OnChainVerificationError("Atomic launch LCKD burn fee is invalid", 422);
    }
    return;
  }
  if (
    !instruction?.programId.equals(SystemProgram.programId) ||
    instruction.parsed?.type !== "transfer" ||
    info.source !== wallet.toBase58() ||
    info.destination !== fee.feeTreasury ||
    info.lamports !== fee.feeLamports
  ) {
    throw new OnChainVerificationError("Atomic launch SOL fee transfer is invalid", 422);
  }
}

function instructionAccountMeta(
  accountKeys: readonly AtomicAccountKey[],
  pubkey: PublicKey,
  isSigner: boolean,
  isWritable: boolean,
) {
  const account = accountKeys.find((candidate) => candidate.pubkey.equals(pubkey));
  if (!account) {
    throw new OnChainVerificationError("Buyback account is missing from the transaction", 422);
  }
  return { pubkey, isSigner, isWritable };
}

function decodePositiveTokenAmount(info: Record<string, unknown>): bigint | null {
  const tokenAmount = info.tokenAmount;
  const amount = typeof info.amount === "string"
    ? info.amount
    : tokenAmount && typeof tokenAmount === "object"
      ? (tokenAmount as { amount?: unknown }).amount
      : null;
  if (typeof amount !== "string" || !/^\d+$/.test(amount)) return null;
  const parsed = BigInt(amount);
  return parsed > BigInt(0) ? parsed : null;
}

function matchingInnerInstructions(
  instructions: readonly RawInstruction[],
  predicate: (instruction: RawInstruction) => boolean,
): Array<{ instruction: RawInstruction; index: number }> {
  return instructions.flatMap((instruction, index) =>
    predicate(instruction) ? [{ instruction, index }] : []);
}

function isCanonicalPumpBuyEventInstruction(instruction: RawInstruction): boolean {
  if (
    instruction.accounts?.length !== 1 ||
    !instruction.accounts[0].equals(PUMP_AMM_EVENT_AUTHORITY_PDA) ||
    instruction.stackHeight !== 3 ||
    !instruction.data
  ) {
    return false;
  }
  try {
    const data = decodeBase58(instruction.data);
    return data.length > PUMP_BUY_EVENT_CPI_PREFIX.length &&
      data.subarray(0, PUMP_BUY_EVENT_CPI_PREFIX.length).equals(PUMP_BUY_EVENT_CPI_PREFIX);
  } catch {
    return false;
  }
}

function assertBuybackTokenBalances(params: {
  accountKeys: readonly AtomicAccountKey[];
  preTokenBalances: TransactionTokenBalance[] | null | undefined;
  postTokenBalances: TransactionTokenBalance[] | null | undefined;
  authority: PublicKey;
  lckdAta: PublicKey;
  wsolAta: PublicKey;
}): bigint {
  const balance = (balances: TransactionTokenBalance[] | null | undefined, account: PublicKey, mint: PublicKey) => {
    const matches = (balances ?? []).filter((candidate) =>
      candidate.mint === mint.toBase58() &&
      candidate.owner === params.authority.toBase58() &&
      params.accountKeys[candidate.accountIndex]?.pubkey.equals(account));
    if (matches.length !== 1) {
      throw new OnChainVerificationError("Buyback PDA token balance proof is incomplete", 422);
    }
    return BigInt(matches[0].uiTokenAmount.amount);
  };
  const preLckd = balance(params.preTokenBalances, params.lckdAta, LCKD_MINT);
  const postLckd = balance(params.postTokenBalances, params.lckdAta, LCKD_MINT);
  const preWsol = balance(params.preTokenBalances, params.wsolAta, NATIVE_MINT);
  const postWsol = balance(params.postTokenBalances, params.wsolAta, NATIVE_MINT);
  if (preLckd !== postLckd || postWsol !== BigInt(0)) {
    throw new OnChainVerificationError("Buyback PDA token balances were not restored", 422);
  }
  return preWsol;
}

function buildVerifiedInnerPumpInstruction(params: {
  instruction: RawInstruction;
  accountKeys: readonly AtomicAccountKey[];
  authority: PublicKey;
  minimumBaseAmountOut: bigint;
}): TransactionInstruction {
  if (!params.instruction.data || !params.instruction.accounts) {
    throw new OnChainVerificationError("Buyback Pump AMM instruction is incomplete", 422);
  }
  const instruction = new TransactionInstruction({
    programId: params.instruction.programId,
    keys: params.instruction.accounts.map((pubkey, index) =>
      instructionAccountMeta(
        params.accountKeys,
        pubkey,
        index === 1,
        PUMP_BUY_EXACT_QUOTE_IN_WRITABLE_INDEXES.has(index),
      )),
    data: decodeBase58(params.instruction.data),
  });
  try {
    validatePumpBuyExactQuoteInInstruction(
      instruction,
      params.authority,
      params.minimumBaseAmountOut,
    );
  } catch (error) {
    throw new OnChainVerificationError(
      error instanceof Error ? error.message : "Buyback Pump AMM instruction is invalid",
      422,
    );
  }
  return instruction;
}

function assertExactBuybackOuterInstruction(params: {
  outerInstruction: RawInstruction;
  pumpInstruction: TransactionInstruction;
  accountKeys: readonly AtomicAccountKey[];
  launcher: PublicKey;
  authority: PublicKey;
  minimumBaseAmountOut: bigint;
}): void {
  const expected = wrapBuybackBurnInstruction({
    programId: BUYBACK_BURN_PROGRAM_ID,
    launcher: params.launcher,
    authority: params.authority,
    pumpInstruction: params.pumpInstruction,
    minimumBaseAmountOut: params.minimumBaseAmountOut,
  });
  const accounts = params.outerInstruction.accounts ?? [];
  if (
    !params.outerInstruction.programId.equals(BUYBACK_BURN_PROGRAM_ID) ||
    !instructionHasData(params.outerInstruction, expected.data) ||
    accounts.length !== expected.keys.length ||
    accounts.some((account, index) => !account.equals(expected.keys[index].pubkey)) ||
    expected.keys.some((meta) => {
      const actual = params.accountKeys.find((account) => account.pubkey.equals(meta.pubkey));
      return !actual || actual.signer !== meta.isSigner || actual.writable !== meta.isWritable;
    })
  ) {
    throw new OnChainVerificationError("Atomic buyback-and-burn instruction is invalid", 422);
  }
}

export function verifyBuybackBurnReceipt(params: {
  outerInstruction: RawInstruction;
  innerInstructionGroups: readonly RawInnerInstructionGroup[];
  accountKeys: readonly AtomicAccountKey[];
  preTokenBalances: TransactionTokenBalance[] | null | undefined;
  postTokenBalances: TransactionTokenBalance[] | null | undefined;
  launcher: PublicKey;
  fee: LaunchFeeTerms;
}): VerifiedBuybackBurnReceipt {
  assertLaunchFeeTerms(params.fee);
  const authority = deriveBuybackBurnAuthority(BUYBACK_BURN_PROGRAM_ID);
  if (
    params.fee.feeMode !== "buybackBurn" ||
    params.fee.feeLamports !== BUYBACK_BURN_LAMPORTS ||
    params.fee.feeTreasury !== authority.toBase58()
  ) {
    throw new OnChainVerificationError("Atomic buyback-and-burn terms are invalid", 422);
  }
  const minimumBaseAmountOut = BigInt(params.fee.feeLckdRaw!);
  const groups = params.innerInstructionGroups.filter(
    (group) => group.index === BUYBACK_BURN_FEE_INSTRUCTION_INDEX,
  );
  if (groups.length !== 1) {
    throw new OnChainVerificationError("Atomic buyback inner instructions are missing", 422);
  }
  const instructions = groups[0].instructions;
  const pumpInvocations = matchingInnerInstructions(instructions, (instruction) =>
    instruction.programId.equals(PUMP_AMM_PROGRAM_ID));
  const pumpMatches = pumpInvocations.filter(({ instruction }) =>
    instruction.accounts?.length === PUMP_BUY_EXACT_QUOTE_IN_ACCOUNT_COUNT &&
    instruction.stackHeight === 2);
  const eventMatches = pumpInvocations.filter(({ instruction }) =>
    isCanonicalPumpBuyEventInstruction(instruction));
  if (pumpInvocations.length !== 2 || pumpMatches.length !== 1 || eventMatches.length !== 1) {
    throw new OnChainVerificationError("Atomic buyback Pump AMM invocation set is invalid", 422);
  }
  const pumpInstruction = buildVerifiedInnerPumpInstruction({
    instruction: pumpMatches[0].instruction,
    accountKeys: params.accountKeys,
    authority,
    minimumBaseAmountOut,
  });
  assertExactBuybackOuterInstruction({ ...params, pumpInstruction, authority, minimumBaseAmountOut });
  return verifyBuybackInnerEffects({
    ...params,
    instructions,
    authority,
    pumpInstruction,
    pumpIndex: pumpMatches[0].index,
    eventIndex: eventMatches[0].index,
    minimumBaseAmountOut,
  });
}

function verifyBuybackInnerEffects(params: {
  instructions: readonly RawInstruction[];
  accountKeys: readonly AtomicAccountKey[];
  preTokenBalances: TransactionTokenBalance[] | null | undefined;
  postTokenBalances: TransactionTokenBalance[] | null | undefined;
  launcher: PublicKey;
  authority: PublicKey;
  pumpInstruction: TransactionInstruction;
  pumpIndex: number;
  eventIndex: number;
  minimumBaseAmountOut: bigint;
}): VerifiedBuybackBurnReceipt {
  const atas = deriveBuybackBurnAtas(params.authority);
  const systemTransfers = matchingInnerInstructions(params.instructions, (instruction) => {
    const info = instruction.parsed?.info ?? {};
    return instruction.programId.equals(SystemProgram.programId) &&
      instruction.parsed?.type === "transfer" &&
      info.source === params.launcher.toBase58() && info.destination === atas.wsol.toBase58();
  });
  const pool = params.pumpInstruction.keys[0].pubkey.toBase58();
  const poolLckd = params.pumpInstruction.keys[7].pubkey.toBase58();
  const tokenTransfers = matchingInnerInstructions(params.instructions, (instruction) => {
    const info = instruction.parsed?.info ?? {};
    return instruction.programId.equals(TOKEN_2022_PROGRAM_ID) &&
      ["transfer", "transferChecked"].includes(instruction.parsed?.type ?? "") &&
      info.source === poolLckd && info.destination === atas.lckd.toBase58() &&
      info.authority === pool && (info.mint === undefined || info.mint === LCKD_MINT.toBase58());
  });
  const burns = matchingInnerInstructions(params.instructions, (instruction) => {
    const info = instruction.parsed?.info ?? {};
    return instruction.programId.equals(TOKEN_2022_PROGRAM_ID) && instruction.parsed?.type === "burn" &&
      info.account === atas.lckd.toBase58() && info.mint === LCKD_MINT.toBase58() &&
      info.authority === params.authority.toBase58();
  });
  const systemInfo = systemTransfers[0]?.instruction.parsed?.info ?? {};
  if (
    systemTransfers.length !== 1 || systemInfo.lamports !== BUYBACK_BURN_LAMPORTS ||
    tokenTransfers.length !== 1 || burns.length !== 1
  ) {
    throw new OnChainVerificationError("Atomic buyback-and-burn inner effects are invalid", 422);
  }
  const transferred = decodePositiveTokenAmount(tokenTransfers[0].instruction.parsed?.info ?? {});
  const burned = decodePositiveTokenAmount(burns[0].instruction.parsed?.info ?? {});
  if (
    transferred === null || burned === null || transferred !== burned ||
    burned < params.minimumBaseAmountOut ||
    !(systemTransfers[0].index < params.pumpIndex && params.pumpIndex < tokenTransfers[0].index &&
      tokenTransfers[0].index < params.eventIndex && params.eventIndex < burns[0].index)
  ) {
    throw new OnChainVerificationError("Atomic buyback-and-burn amounts are invalid", 422);
  }
  const preWsol = assertBuybackTokenBalances({
    ...params,
    lckdAta: atas.lckd,
    wsolAta: atas.wsol,
  });
  const protocolWsol = params.pumpInstruction.keys[10].pubkey.toBase58();
  const donationSweeps = matchingInnerInstructions(params.instructions, (instruction) => {
    const info = instruction.parsed?.info ?? {};
    return instruction.programId.equals(TOKEN_PROGRAM_ID) &&
      instruction.parsed?.type === "transfer" &&
      info.source === atas.wsol.toBase58() && info.destination === protocolWsol &&
      info.authority === params.authority.toBase58();
  }).filter((match) => match.index < systemTransfers[0].index);
  const swept = donationSweeps.length === 1
    ? decodePositiveTokenAmount(donationSweeps[0].instruction.parsed?.info ?? {})
    : null;
  if (
    donationSweeps.length > 1 ||
    (donationSweeps.length === 1 && swept === null) ||
    (preWsol > BigInt(0) && (swept === null || swept < preWsol))
  ) {
    throw new OnChainVerificationError("Buyback donated WSOL sweep is invalid", 422);
  }
  return {
    burnedRawAmount: burned,
    protocolLookupAddresses: [...new Set(
      params.pumpInstruction.keys.map((account) => account.pubkey.toBase58()),
    )],
  };
}

function assertAtomicLookupDeactivation(
  instruction: RawInstruction,
  wallet: PublicKey,
  lookupTable: PublicKey,
): void {
  const info = instruction.parsed?.info ?? {};
  if (
    !instruction.programId.equals(AddressLookupTableProgram.programId) ||
    instruction.parsed?.type !== "deactivateLookupTable" ||
    info.lookupTableAccount !== lookupTable.toBase58() ||
    info.lookupTableAuthority !== wallet.toBase58()
  ) {
    throw new OnChainVerificationError("Atomic launch lookup table was not deactivated", 422);
  }
}

function assertAtomicStreamflowAccounts(
  instruction: RawInstruction,
  wallet: PublicKey,
  mint: PublicKey,
  metadata: PublicKey,
): PublicKey {
  const walletAta = getAssociatedTokenAddressSync(mint, wallet, false, TOKEN_PROGRAM_ID);
  const treasuryAta = getAssociatedTokenAddressSync(
    mint,
    STREAMFLOW_TREASURY,
    false,
    TOKEN_PROGRAM_ID,
  );
  const [escrow] = PublicKey.findProgramAddressSync(
    [Buffer.from("strm"), metadata.toBuffer()],
    new PublicKey(DEFAULT_STREAMFLOW_PROGRAM_ID),
  );
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
    STREAMFLOW_MAINNET_FEE_ORACLE,
    SYSVAR_RENT_PUBKEY,
    new PublicKey(DEFAULT_STREAMFLOW_PROGRAM_ID),
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    SystemProgram.programId,
  ];
  const accounts = instruction.accounts ?? [];
  if (
    !instruction.programId.equals(new PublicKey(DEFAULT_STREAMFLOW_PROGRAM_ID)) ||
    accounts.length !== expectedAccounts.length ||
    accounts.some((account, index) => !account.equals(expectedAccounts[index]))
  ) {
    throw new OnChainVerificationError("Atomic Streamflow account layout is invalid", 422);
  }
  return escrow;
}

function mintAccountBalance(
  balances: TransactionTokenBalance[] | null | undefined,
  accountKeys: readonly { pubkey: PublicKey }[],
  account: PublicKey,
  mint: PublicKey,
): bigint {
  return (balances ?? [])
    .filter(
      (balance) =>
        balance.mint === mint.toBase58() &&
        accountKeys[balance.accountIndex]?.pubkey.equals(account),
    )
    .reduce((total, balance) => total + BigInt(balance.uiTokenAmount.amount), BigInt(0));
}

async function assertFinalizedAtomicAccounts(
  connection: Connection,
  wallet: PublicKey,
  mintAddress: PublicKey,
  metadata: PublicKey,
  escrow: PublicKey,
  amount: bigint,
  unlockTimestamp: number,
): Promise<void> {
  const [mintAccount, metadataAccount, escrowBalance] = await Promise.all([
    connection.getAccountInfo(mintAddress, "finalized"),
    connection.getAccountInfo(metadata, "finalized"),
    connection.getTokenAccountBalance(escrow, "finalized"),
  ]);
  if (!mintAccount?.owner.equals(TOKEN_PROGRAM_ID)) {
    throw new OnChainVerificationError("Atomic launch mint is not a legacy SPL token", 422);
  }
  const mint = await getMint(connection, mintAddress, "finalized", TOKEN_PROGRAM_ID);
  if (
    !mint.isInitialized ||
    mint.decimals !== PUMPFUN_TOKEN_DECIMALS ||
    mint.supply <= BigInt(0) ||
    mint.mintAuthority !== null ||
    mint.freezeAuthority !== null
  ) {
    throw new OnChainVerificationError("Atomic launch mint authorities or decimals are unsafe", 422);
  }
  const streamflowProgram = new PublicKey(DEFAULT_STREAMFLOW_PROGRAM_ID);
  if (!metadataAccount?.owner.equals(streamflowProgram)) {
    throw new OnChainVerificationError("Streamflow metadata account state is invalid", 422);
  }
  if (BigInt(escrowBalance.value.amount) !== amount) {
    throw new OnChainVerificationError("Streamflow escrow balance does not match its deposit", 422);
  }

  const client = new SolanaStreamClient({
    clusterUrl: connection.rpcEndpoint,
    cluster: ICluster.Mainnet,
    commitment: "finalized",
  });
  let stream;
  try {
    stream = await client.getOne({ id: metadata.toBase58() });
  } catch {
    throw new OnChainVerificationError("Finalized Streamflow state is unavailable", 503);
  }
  const walletAddress = wallet.toBase58();
  const walletTokenAccount = getAssociatedTokenAddressSync(
    mintAddress,
    wallet,
    false,
    TOKEN_PROGRAM_ID,
  ).toBase58();
  const treasuryTokenAccount = getAssociatedTokenAddressSync(
    mintAddress,
    STREAMFLOW_TREASURY,
    false,
    TOKEN_PROGRAM_ID,
  ).toBase58();
  if (
    stream.type !== StreamType.Lock ||
    stream.closed ||
    stream.canceledAt !== 0 ||
    !stream.withdrawnAmount.isZero() ||
    stream.sender !== walletAddress ||
    stream.senderTokens !== walletTokenAccount ||
    stream.recipient !== walletAddress ||
    stream.recipientTokens !== walletTokenAccount ||
    stream.mint !== mintAddress.toBase58() ||
    stream.escrowTokens !== escrow.toBase58() ||
    stream.streamflowTreasury !== STREAMFLOW_TREASURY.toBase58() ||
    stream.streamflowTreasuryTokens !== treasuryTokenAccount ||
    stream.partner !== walletAddress ||
    stream.partnerTokens !== walletTokenAccount ||
    (stream.payer !== walletAddress && stream.payer !== SystemProgram.programId.toBase58()) ||
    stream.depositedAmount.toString() !== amount.toString() ||
    stream.start !== unlockTimestamp ||
    stream.cliff !== unlockTimestamp ||
    stream.period !== 1 ||
    !stream.amountPerPeriod.eqn(1) ||
    !stream.cliffAmount.eq(stream.depositedAmount) ||
    !stream.unlocked(unlockTimestamp - 1).isZero() ||
    !stream.unlocked(unlockTimestamp).eq(stream.depositedAmount) ||
    stream.end < stream.cliff ||
    stream.end - stream.cliff > 1 ||
    stream.currentPauseStart !== 0 ||
    stream.lastRateChangeTime !== 0 ||
    stream.cancelRequestTime !== 0 ||
    stream.canTopup ||
    stream.automaticWithdrawal ||
    stream.cancelableBySender ||
    stream.cancelableByRecipient ||
    stream.transferableBySender ||
    stream.transferableByRecipient
  ) {
    throw new OnChainVerificationError("Finalized Streamflow cliff lock state is invalid", 422);
  }
}

export async function verifyFinalizedAtomicLaunchTransaction(
  signature: string,
  walletAddress: string,
  mintAddress: string,
  metadataAddress: string,
  expectation: AtomicLaunchExpectation,
): Promise<VerifiedAtomicLaunch> {
  assertAtomicExpectation(expectation);
  const hasLock = expectation.hasLock !== false;
  const transaction = await getFinalizedTransaction(signature, walletAddress, mintAddress);
  const wallet = new PublicKey(walletAddress);
  const mint = new PublicKey(mintAddress);
  const metadata = new PublicKey(metadataAddress);
  const lookupTable = new PublicKey(expectation.lookupTableAddress);
  const isBuybackBurn = expectation.fee.feeMode === "buybackBurn";
  const connection = await getConnection();
  assertExactAtomicSigners(transaction, wallet, mint, metadata, signature);
  const buybackIssuance = isBuybackBurn
    ? await verifyBuybackIssuance({ connection, signature, lookupTable, expectation })
    : null;
  assertAtomicLookupTables(transaction, [
    {
      lookupTable,
      addresses: expectation.lookupTableAddresses,
      requireAllAddresses: true,
    },
    ...(buybackIssuance ? [{
      lookupTable: buybackIssuance.protocolLookupTable,
      addresses: buybackIssuance.protocolLookupAddresses,
      requireAllAddresses: false,
    }] : []),
  ]);
  assertNoUnusedAtomicAccounts(transaction);
  const meta = transaction.meta;
  if (!meta) {
    throw new OnChainVerificationError("Atomic transaction metadata is unavailable", 422);
  }

  const instructions = transaction.transaction.message.instructions as RawInstruction[];
  const expectedLimit = ComputeBudgetProgram.setComputeUnitLimit({
    units: ATOMIC_COMPUTE_UNIT_LIMIT,
  }).data;
  const expectedPrice = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: ATOMIC_COMPUTE_UNIT_PRICE,
  }).data;
  assertLaunchFeeTerms(expectation.fee);
  const expectedInstructionCount = expectation.fee.feeMode === "waived" || isBuybackBurn
    ? ATOMIC_OUTER_INSTRUCTION_COUNT
    : ATOMIC_OUTER_INSTRUCTION_COUNT + 1;
  if (
    instructions.length !== expectedInstructionCount ||
    !instructions[0]?.programId.equals(ComputeBudgetProgram.programId) ||
    !instructionHasData(instructions[0], expectedLimit) ||
    !instructions[1]?.programId.equals(ComputeBudgetProgram.programId) ||
    !instructionHasData(instructions[1], expectedPrice)
  ) {
    throw new OnChainVerificationError("Atomic launch compute budget is invalid", 422);
  }

  let createData: PumpCreateData;
  let maxBuyAmountLamports: bigint;
  try {
    const createInstruction = instructions[2];
    if (
      !createInstruction?.programId.equals(new PublicKey(PUMPFUN_PROGRAM_ID)) ||
      !createInstruction.data ||
      !createInstruction.accounts
    ) {
      throw new Error("Pump create instruction is missing");
    }
    createData = validatePumpCreateInstruction(
      decodeBase58(createInstruction.data),
      createInstruction.accounts,
      wallet,
      mint,
      {
        name: expectation.name,
        symbol: expectation.symbol,
        metadataUri: expectation.metadataUri,
      },
    );
    if (createData.version !== "create") throw new Error("Pump create must use the legacy mint");
    assertAtomicAtaInstruction(instructions[3], wallet, mint);
    const buyInstruction = instructions[4];
    if (
      !buyInstruction?.programId.equals(new PublicKey(PUMPFUN_PROGRAM_ID)) ||
      !buyInstruction.data ||
      !buyInstruction.accounts
    ) {
      throw new Error("Pump exact-token buy instruction is missing");
    }
    const buyData = decodeBase58(buyInstruction.data);
    if (buyData.subarray(0, 8).toString("hex") !== PUMP_EXACT_TOKEN_BUY_DISCRIMINATOR) {
      throw new Error("Pump buy must request an exact token amount");
    }
    maxBuyAmountLamports = validatePumpBuyInstruction(
      buyData,
      buyInstruction.accounts,
      wallet,
      mint,
      createData,
    );
    const expectedMaxBuyAmount = BigInt(expectation.maxQuoteAmount);
    if (maxBuyAmountLamports !== expectedMaxBuyAmount) {
      throw new Error("Pump buy spend limit does not match the reviewed configuration");
    }
  } catch (error) {
    if (error instanceof OnChainVerificationError) throw error;
    throw new OnChainVerificationError(
      error instanceof Error ? error.message : "Atomic Pump launch validation failed",
      422,
    );
  }

  const launchMarkerInstruction = instructions[5];
  const escrow = hasLock
    ? assertAtomicStreamflowAccounts(launchMarkerInstruction, wallet, mint, metadata)
    : null;
  const parsedLock = hasLock
    ? parseVerifiedStreamflowLock(launchMarkerInstruction, transaction.blockTime)
    : null;
  if (parsedLock) {
    const expectedLockName = Buffer.alloc(64);
    Buffer.from(expectation.name, "utf8").copy(expectedLockName);
    const lockData = decodeBase58(launchMarkerInstruction.data ?? "");
    if (
      !lockData.subarray(62, 126).equals(expectedLockName) ||
      parsedLock.amount !== expectation.lockAmount ||
      parsedLock.unlockAt !== new Date(expectation.unlockTimestamp * 1_000).toISOString() ||
      parsedLock.durationDays !== expectation.lockDurationDays
    ) {
      throw new OnChainVerificationError("Atomic Streamflow schedule does not match the intent", 422);
    }
  } else if (
    !launchMarkerInstruction.programId.equals(NO_LOCK_MEMO_PROGRAM_ID) ||
    !instructionHasData(launchMarkerInstruction, NO_LOCK_MEMO) ||
    launchMarkerInstruction.accounts?.length !== 1 ||
    !launchMarkerInstruction.accounts[0].equals(metadata)
  ) {
    throw new OnChainVerificationError("Atomic no-lock marker does not match the intent", 422);
  }
  let verifiedBuyback: VerifiedBuybackBurnReceipt | null = null;
  if (isBuybackBurn) {
    verifiedBuyback = verifyBuybackBurnReceipt({
      outerInstruction: instructions[BUYBACK_BURN_FEE_INSTRUCTION_INDEX],
      innerInstructionGroups: (meta.innerInstructions ?? []) as RawInnerInstructionGroup[],
      accountKeys: transaction.transaction.message.accountKeys,
      preTokenBalances: meta.preTokenBalances,
      postTokenBalances: meta.postTokenBalances,
      launcher: wallet,
      fee: expectation.fee,
    });
    if (
      !buybackIssuance ||
      verifiedBuyback.protocolLookupAddresses.length !==
        buybackIssuance.protocolLookupAddresses.length ||
      verifiedBuyback.protocolLookupAddresses.some(
        (address, index) => address !== buybackIssuance.protocolLookupAddresses[index],
      )
    ) {
      throw new OnChainVerificationError("Buyback protocol lookup address vector is invalid", 422);
    }
  } else if (expectation.fee.feeMode !== "waived") {
    assertAtomicFeeInstruction(instructions[6], wallet, expectation.fee);
  }
  if (!isBuybackBurn) {
    assertAtomicLookupDeactivation(instructions[instructions.length - 1], wallet, lookupTable);
  }

  let tradeEvent: VerifiedPumpTradeEvent | null = null;
  try {
    for (const instruction of (meta.innerInstructions ?? []).flatMap(
      (group) => group.instructions as RawInstruction[],
    )) {
      if (!instruction.programId.equals(new PublicKey(PUMPFUN_PROGRAM_ID)) || !instruction.data) continue;
      const parsedEvent = parsePumpTradeEvent(decodeBase58(instruction.data));
      if (!parsedEvent) continue;
      if (tradeEvent) throw new Error("Atomic launch contains multiple Pump trade events");
      tradeEvent = parsedEvent;
    }
  } catch (error) {
    throw new OnChainVerificationError(
      error instanceof Error ? error.message : "Atomic Pump trade event is invalid",
      422,
    );
  }
  if (
    !tradeEvent ||
    !tradeEvent.mint.equals(mint) ||
    !tradeEvent.user.equals(wallet) ||
    tradeEvent.tokenAmount <= BigInt(0) ||
    tradeEvent.tokenAmount !== BigInt(expectation.quotedTokenAmount) ||
    tradeEvent.totalSolAmount <= BigInt(0) ||
    tradeEvent.totalSolAmount < BigInt(Math.round(expectation.buyAmountSol * 1_000_000_000)) ||
    tradeEvent.totalSolAmount > maxBuyAmountLamports
  ) {
    throw new OnChainVerificationError("Finalized atomic Pump purchase event is invalid", 422);
  }
  const requestedTokenAmount = decodeBase58(instructions[4].data ?? "").readBigUInt64LE(8);
  if (requestedTokenAmount !== tradeEvent.tokenAmount) {
    throw new OnChainVerificationError("Pump exact-token output does not match its event", 422);
  }

  const accountKeys = transaction.transaction.message.accountKeys;
  const preWalletBalance = sumWalletMintBalances(
    meta.preTokenBalances,
    walletAddress,
    mintAddress,
  );
  const postWalletBalance = sumWalletMintBalances(
    meta.postTokenBalances,
    walletAddress,
    mintAddress,
  );
  const preEscrowBalance = escrow
    ? mintAccountBalance(meta.preTokenBalances, accountKeys, escrow, mint)
    : BigInt(0);
  const postEscrowBalance = escrow
    ? mintAccountBalance(meta.postTokenBalances, accountKeys, escrow, mint)
    : BigInt(0);
  const depositedAmount = parsedLock ? BigInt(parsedLock.amount) : BigInt(0);
  const walletDelta = postWalletBalance - preWalletBalance;
  const debitedAmount = tradeEvent.tokenAmount - postWalletBalance;
  const reviewedDebit =
    (tradeEvent.tokenAmount * BigInt(expectation.lockPercentage)) / BigInt(100);
  if (hasLock && (
    preWalletBalance !== BigInt(0) ||
    preEscrowBalance !== BigInt(0) ||
    postWalletBalance < BigInt(0) ||
    postWalletBalance >= tradeEvent.tokenAmount ||
    postEscrowBalance !== depositedAmount ||
    depositedAmount <= BigInt(0) ||
    depositedAmount > debitedAmount ||
    debitedAmount + LOCK_COVERAGE_TOLERANCE < reviewedDebit ||
    debitedAmount > reviewedDebit + LOCK_COVERAGE_TOLERANCE
  )) {
    throw new OnChainVerificationError("Atomic Streamflow deposit does not cover the purchase", 422);
  }
  if (!hasLock && (
    preWalletBalance !== BigInt(0) ||
    postWalletBalance !== tradeEvent.tokenAmount ||
    walletDelta !== tradeEvent.tokenAmount ||
    debitedAmount !== BigInt(0)
  )) {
    throw new OnChainVerificationError(
      "Atomic unlocked purchase does not remain in the launch wallet",
      422,
    );
  }
  const percentage = hasLock
    ? Number((depositedAmount * BigInt(1_000_000)) / tradeEvent.tokenAmount) / 10_000
    : 0;
  if (hasLock && (percentage <= 0 || percentage > 100)) {
    throw new OnChainVerificationError("Atomic lock percentage is invalid", 422);
  }

  await Promise.all([
    ...(hasLock && escrow ? [assertFinalizedAtomicAccounts(
      connection,
      wallet,
      mint,
      metadata,
      escrow,
      depositedAmount,
      expectation.unlockTimestamp,
    )] : []),
    assertFinalizedAtomicLookupTable(
      connection,
      lookupTable,
      wallet,
      expectation.lookupTableAddresses,
      !isBuybackBurn,
    ),
  ]);
  return {
    signature,
    executedAt: new Date((transaction.blockTime ?? 0) * 1_000).toISOString(),
    metadataAddress,
    lookupTableAddress: lookupTable.toBase58(),
    walletDelta: walletDelta.toString(),
    walletFinalBalance: postWalletBalance.toString(),
    escrowBalance: postEscrowBalance.toString(),
    burnedLckdRawAmount: verifiedBuyback?.burnedRawAmount.toString() ?? null,
    purchasedAmount: tradeEvent.tokenAmount,
    name: createData.name,
    symbol: createData.symbol,
    metadataUri: createData.metadataUri,
    buyAmountLamports: tradeEvent.totalSolAmount,
    lock: parsedLock
      ? { ...parsedLock, percentage, debitedAmount: debitedAmount.toString() }
      : null,
  };
}
