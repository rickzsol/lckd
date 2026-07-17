import "server-only";

import { createHash } from "node:crypto";
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
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
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
import {
  buildLookupTablePreparation,
  canonicalLookupAddresses,
  hashLookupAddresses,
  resolveExactLookupTable,
  validateExactLookupTable,
  type LookupTablePreparation,
} from "./lookupTable";
import { validatePumpBuyInstruction } from "./pumpBuyValidation";
import { validatePumpCreateInstruction } from "./pumpCreateValidation";
import {
  calculateLockAmount,
  getConfirmedClusterTimestamp,
  getStreamflowTotalFeePercent,
  lockDaysToSeconds,
} from "./streamflow";
import {
  buildStreamflowCreateInstruction,
  createStreamflowInstructionExpectation,
  validateStreamflowCreateInstruction,
} from "./streamflowInstruction";

const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const ATOMIC_COMPUTE_UNIT_LIMIT = 400_000;
export const LOCK_SUBMISSION_BUFFER_SECONDS = 120;
const FEE_RECIPIENT = new PublicKey("62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV");
const BUYBACK_FEE_RECIPIENT = new PublicKey("5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD");
const CONFIG_KEYS = [
  "name",
  "ticker",
  "buyAmountSol",
  "lockDurationDays",
  "lockPercentage",
] as const;

export interface FrozenAtomicLaunchConfig {
  readonly name: string;
  readonly ticker: string;
  readonly buyAmountSol: number;
  readonly lockDurationDays: number;
  readonly lockPercentage: number;
}

export interface AtomicLaunchIdentity {
  config: FrozenAtomicLaunchConfig;
  walletPublicKey: PublicKey;
  mintPublicKey: PublicKey;
  metadataPublicKey: PublicKey;
  metadataUri: string;
}

export interface AtomicInstructionPlan {
  instructions: readonly TransactionInstruction[];
  quotedTokenAmount: BN;
  maxQuoteAmount: BN;
  lockAmount: BN;
  unlockTimestamp: number;
  streamflowFeePercent: number;
}

export interface AtomicLookupPreparationBundle extends LookupTablePreparation {
  quotedTokenAmount: string;
  maxQuoteAmount: string;
  lockAmount: string;
  unlockTimestamp: number;
  streamflowFeePercent: number;
  messageHash: string;
}

export interface AtomicLaunchBundle {
  txBytes: Uint8Array;
  blockhash: string;
  lastValidBlockHeight: number;
  lookupTableAddress: PublicKey;
  addressHash: string;
  quotedTokenAmount: string;
  maxQuoteAmount: string;
  lockAmount: string;
  unlockTimestamp: number;
  streamflowFeePercent: number;
  messageHash: string;
}

export interface AtomicLaunchValidationExpectation extends AtomicLaunchIdentity {
  lookupTable: AddressLookupTableAccount;
  lookupAddresses: readonly PublicKey[];
  instructions: readonly TransactionInstruction[];
  quotedTokenAmount: BN;
  maxQuoteAmount: BN;
  lockAmount: BN;
  unlockTimestamp: number;
  blockhash: string;
}

let connectionPromise: Promise<Connection> | null = null;

async function getConnection(): Promise<Connection> {
  const rpcUrl = process.env.HELIUS_RPC_URL ?? (
    process.env.NODE_ENV === "production" ? undefined : process.env.NEXT_PUBLIC_HELIUS_RPC_URL
  );
  if (!rpcUrl) throw new Error("Atomic launch construction is unavailable");
  if (!connectionPromise) {
    connectionPromise = (async () => {
      const connection = new Connection(rpcUrl, "confirmed");
      if (await connection.getGenesisHash() !== MAINNET_GENESIS_HASH) {
        throw new Error("Atomic launch construction cluster mismatch");
      }
      return connection;
    })().catch((error) => {
      connectionPromise = null;
      throw error;
    });
  }
  return connectionPromise;
}

export function freezeAtomicLaunchConfig(
  config: Pick<LaunchConfig, (typeof CONFIG_KEYS)[number]>,
): FrozenAtomicLaunchConfig {
  const frozen = Object.freeze({
    name: config.name,
    ticker: config.ticker,
    buyAmountSol: config.buyAmountSol,
    lockDurationDays: config.lockDurationDays,
    lockPercentage: config.lockPercentage,
  });
  assertFrozenAtomicLaunchConfig(frozen);
  return frozen;
}

export function assertFrozenAtomicLaunchConfig(
  config: FrozenAtomicLaunchConfig,
): void {
  const keys = Object.keys(config).sort();
  if (!Object.isFrozen(config) || keys.join(",") !== [...CONFIG_KEYS].sort().join(",")) {
    throw new Error("Atomic launch config must be an exact frozen snapshot");
  }
  if (
    config.name !== config.name.trim() ||
    Buffer.byteLength(config.name, "utf8") < 1 ||
    Buffer.byteLength(config.name, "utf8") > 32
  ) {
    throw new Error("Atomic launch token name is invalid");
  }
  if (
    config.ticker !== config.ticker.trim() ||
    Buffer.byteLength(config.ticker, "utf8") < 1 ||
    Buffer.byteLength(config.ticker, "utf8") > 13
  ) {
    throw new Error("Atomic launch token ticker is invalid");
  }
  if (!Number.isFinite(config.buyAmountSol) || config.buyAmountSol < 0.01 || config.buyAmountSol > 100) {
    throw new Error("Atomic launch buy amount is invalid");
  }
  if (!Number.isInteger(config.lockDurationDays) || config.lockDurationDays < 7 || config.lockDurationDays > 365) {
    throw new Error("Atomic launch lock duration is invalid");
  }
  if (!Number.isInteger(config.lockPercentage) || config.lockPercentage < 51 || config.lockPercentage > 99) {
    throw new Error("Atomic launch lock percentage is invalid");
  }
}

function assertIdentity(identity: AtomicLaunchIdentity): void {
  assertFrozenAtomicLaunchConfig(identity.config);
  if (
    identity.walletPublicKey.equals(identity.mintPublicKey) ||
    identity.walletPublicKey.equals(identity.metadataPublicKey) ||
    identity.mintPublicKey.equals(identity.metadataPublicKey)
  ) {
    throw new Error("Atomic launch signers must be distinct");
  }
  let metadataUrl: URL;
  try {
    metadataUrl = new URL(identity.metadataUri);
  } catch {
    throw new Error("Atomic launch metadata URI is invalid");
  }
  if (metadataUrl.protocol !== "https:" || identity.metadataUri.length > 200) {
    throw new Error("Atomic launch metadata URI must be an HTTPS URL of at most 200 characters");
  }
}

function solToLamports(solAmount: number): number {
  const lamports = Math.round(solAmount * LAMPORTS_PER_SOL);
  if (!Number.isSafeInteger(lamports) || lamports <= 0) {
    throw new Error("Atomic launch buy amount cannot be represented in lamports");
  }
  return lamports;
}

export function hashAtomicTransactionMessage(transactionBytes: Uint8Array): string {
  const transaction = VersionedTransaction.deserialize(transactionBytes);
  return createHash("sha256").update(transaction.message.serialize()).digest("hex");
}

export function calculateAtomicUnlockTimestamp(
  clusterTimestamp: number,
  lockDurationDays: number,
): number {
  if (!Number.isSafeInteger(clusterTimestamp) || clusterTimestamp < 1) {
    throw new Error("Atomic launch cluster timestamp is invalid");
  }
  const unlockTimestamp = clusterTimestamp + LOCK_SUBMISSION_BUFFER_SECONDS +
    lockDaysToSeconds(lockDurationDays);
  if (!Number.isSafeInteger(unlockTimestamp)) {
    throw new Error("Atomic launch unlock timestamp is invalid");
  }
  return unlockTimestamp;
}

export async function buildAtomicLaunchInstructions(
  identity: AtomicLaunchIdentity,
  quote: {
    quotedTokenAmount: BN;
    maxQuoteAmount: BN;
    streamflowFeePercent: number;
    unlockTimestamp: number;
  },
): Promise<AtomicInstructionPlan> {
  assertIdentity(identity);
  if (!BN.isBN(quote.quotedTokenAmount) || quote.quotedTokenAmount.lten(0)) {
    throw new Error("Atomic launch token quote is invalid");
  }
  if (!BN.isBN(quote.maxQuoteAmount) || quote.maxQuoteAmount.lten(0)) {
    throw new Error("Atomic launch spend limit is invalid");
  }
  if (!Number.isSafeInteger(quote.unlockTimestamp) || quote.unlockTimestamp < 1) {
    throw new Error("Atomic launch unlock timestamp is invalid");
  }
  const lockAmount = calculateLockAmount(
    BigInt(quote.quotedTokenAmount.toString()),
    identity.config.lockPercentage,
    quote.streamflowFeePercent,
  );
  const associatedUser = getAssociatedTokenAddressSync(
    identity.mintPublicKey,
    identity.walletPublicKey,
    false,
    TOKEN_PROGRAM_ID,
  );
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: ATOMIC_COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: DEFAULT_PRIORITY_FEE_MICROLAMPORTS,
    }),
    await PUMP_SDK.createInstruction({
      mint: identity.mintPublicKey,
      name: identity.config.name,
      symbol: identity.config.ticker,
      uri: identity.metadataUri,
      creator: identity.walletPublicKey,
      user: identity.walletPublicKey,
    }),
    createAssociatedTokenAccountIdempotentInstruction(
      identity.walletPublicKey,
      associatedUser,
      identity.walletPublicKey,
      identity.mintPublicKey,
      TOKEN_PROGRAM_ID,
    ),
    await PUMP_SDK.getBuyInstructionRaw({
      user: identity.walletPublicKey,
      mint: identity.mintPublicKey,
      creator: identity.walletPublicKey,
      amount: quote.quotedTokenAmount,
      solAmount: quote.maxQuoteAmount,
      feeRecipient: FEE_RECIPIENT,
      buybackFeeRecipient: BUYBACK_FEE_RECIPIENT,
      tokenProgram: TOKEN_PROGRAM_ID,
    }),
    await buildStreamflowCreateInstruction({
      sender: identity.walletPublicKey,
      mint: identity.mintPublicKey,
      metadata: identity.metadataPublicKey,
      amount: lockAmount,
      unlockTimestamp: quote.unlockTimestamp,
      name: identity.config.name,
    }),
  ];
  return Object.freeze({
    instructions: Object.freeze(instructions),
    quotedTokenAmount: quote.quotedTokenAmount.clone(),
    maxQuoteAmount: quote.maxQuoteAmount.clone(),
    lockAmount,
    unlockTimestamp: quote.unlockTimestamp,
    streamflowFeePercent: quote.streamflowFeePercent,
  });
}

async function buildQuotedPlan(
  connection: Connection,
  identity: AtomicLaunchIdentity,
): Promise<AtomicInstructionPlan> {
  assertIdentity(identity);
  const onlineSdk = new OnlinePumpSdk(connection);
  const [global, feeConfig, streamflowFeePercent, clusterTimestamp] = await Promise.all([
    onlineSdk.fetchGlobal(),
    onlineSdk.fetchFeeConfig(),
    getStreamflowTotalFeePercent(connection, identity.walletPublicKey),
    getConfirmedClusterTimestamp(connection),
  ]);
  const buyAmount = new BN(solToLamports(identity.config.buyAmountSol));
  const quotedTokenAmount = getBuyTokenAmountFromSolAmount({
    global,
    feeConfig,
    mintSupply: null,
    bondingCurve: null,
    amount: buyAmount,
    quoteMint: NATIVE_MINT,
  });
  const maxQuoteAmount = buyAmount
    .muln(10_000 + DEFAULT_SLIPPAGE_BPS)
    .addn(9_999)
    .divn(10_000);
  return buildAtomicLaunchInstructions(identity, {
    quotedTokenAmount,
    maxQuoteAmount,
    streamflowFeePercent,
    unlockTimestamp: calculateAtomicUnlockTimestamp(
      clusterTimestamp,
      identity.config.lockDurationDays,
    ),
  });
}

function lookupAddressesForPlan(
  identity: AtomicLaunchIdentity,
  plan: AtomicInstructionPlan,
): readonly PublicKey[] {
  return canonicalLookupAddresses(plan.instructions, [
    identity.walletPublicKey,
    identity.mintPublicKey,
    identity.metadataPublicKey,
  ]);
}

export async function buildAtomicLookupPreparation(
  identity: AtomicLaunchIdentity,
): Promise<AtomicLookupPreparationBundle> {
  const connection = await getConnection();
  const [plan, recentSlot, latestBlockhash] = await Promise.all([
    buildQuotedPlan(connection, identity),
    connection.getSlot("finalized"),
    connection.getLatestBlockhash("confirmed"),
  ]);
  const addresses = lookupAddressesForPlan(identity, plan);
  const preparation = buildLookupTablePreparation({
    authority: identity.walletPublicKey,
    payer: identity.walletPublicKey,
    addresses,
    recentSlot,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  });
  return Object.freeze({
    ...preparation,
    quotedTokenAmount: plan.quotedTokenAmount.toString(),
    maxQuoteAmount: plan.maxQuoteAmount.toString(),
    lockAmount: plan.lockAmount.toString(),
    unlockTimestamp: plan.unlockTimestamp,
    streamflowFeePercent: plan.streamflowFeePercent,
    messageHash: hashAtomicTransactionMessage(preparation.transaction),
  });
}

function decompileInstruction(
  transaction: VersionedTransaction,
  lookupTable: AddressLookupTableAccount,
  index: number,
): TransactionInstruction {
  const message = transaction.message;
  const instruction = message.compiledInstructions[index];
  if (!instruction) throw new Error("Atomic launch instruction is missing");
  const accountKeys = message.getAccountKeys({ addressLookupTableAccounts: [lookupTable] });
  const programId = accountKeys.get(instruction.programIdIndex);
  if (!programId) throw new Error("Atomic launch program ID cannot be resolved");
  return new TransactionInstruction({
    programId,
    data: Buffer.from(instruction.data),
    keys: [...instruction.accountKeyIndexes].map((accountIndex) => {
      const pubkey = accountKeys.get(accountIndex);
      if (!pubkey) throw new Error("Atomic launch account cannot be resolved");
      return {
        pubkey,
        isSigner: message.isAccountSigner(accountIndex),
        isWritable: message.isAccountWritable(accountIndex),
      };
    }),
  });
}

interface ExpectedPrivilege {
  isSigner: boolean;
  isWritable: boolean;
}

function expectedPrivileges(
  payer: PublicKey,
  instructions: readonly TransactionInstruction[],
): ReadonlyMap<string, ExpectedPrivilege> {
  const privileges = new Map<string, ExpectedPrivilege>([
    [payer.toBase58(), { isSigner: true, isWritable: true }],
  ]);
  for (const instruction of instructions) {
    for (const account of instruction.keys) {
      const encoded = account.pubkey.toBase58();
      const current = privileges.get(encoded);
      privileges.set(encoded, {
        isSigner: account.isSigner || current?.isSigner === true,
        isWritable: account.isWritable || current?.isWritable === true,
      });
    }
  }
  return privileges;
}

function assertInstruction(
  actual: TransactionInstruction,
  expected: TransactionInstruction,
  privileges: ReadonlyMap<string, ExpectedPrivilege>,
): void {
  if (
    !actual.programId.equals(expected.programId) ||
    !actual.data.equals(expected.data) ||
    actual.keys.length !== expected.keys.length ||
    actual.keys.some((account, index) => {
      const exact = expected.keys[index];
      const privilege = privileges.get(account.pubkey.toBase58());
      return !exact || !privilege || !account.pubkey.equals(exact.pubkey) ||
        account.isSigner !== privilege.isSigner || account.isWritable !== privilege.isWritable;
    })
  ) {
    throw new Error("Atomic launch instruction sequence mismatch");
  }
}

export function validateAtomicLaunchTransaction(
  txBytes: Uint8Array,
  expectation: AtomicLaunchValidationExpectation,
): VersionedTransaction {
  assertIdentity(expectation);
  if (txBytes.length > 1_232) throw new Error("Atomic launch transaction exceeds packet size");
  validateExactLookupTable(
    expectation.lookupTable,
    expectation.lookupTable.key,
    expectation.walletPublicKey,
    expectation.lookupAddresses,
    expectation.lookupTable.state.lastExtendedSlot + 1,
  );
  const transaction = VersionedTransaction.deserialize(txBytes);
  const message = transaction.message;
  const signers = message.staticAccountKeys.slice(0, message.header.numRequiredSignatures);
  const expectedSigners = [
    expectation.walletPublicKey,
    expectation.mintPublicKey,
    expectation.metadataPublicKey,
  ];
  if (
    message.addressTableLookups.length !== 1 ||
    !message.addressTableLookups[0]?.accountKey.equals(expectation.lookupTable.key) ||
    message.recentBlockhash !== expectation.blockhash ||
    signers.length !== expectedSigners.length ||
    signers.some((signer, index) => !signer.equals(expectedSigners[index])) ||
    expectation.instructions.length !== 7 ||
    message.compiledInstructions.length !== 7
  ) {
    throw new Error("Atomic launch transaction envelope mismatch");
  }
  const actual = message.compiledInstructions.map((_, index) =>
    decompileInstruction(transaction, expectation.lookupTable, index));
  const privileges = expectedPrivileges(expectation.walletPublicKey, expectation.instructions);
  actual.forEach((instruction, index) =>
    assertInstruction(instruction, expectation.instructions[index], privileges));

  const create = validatePumpCreateInstruction(
    actual[2].data,
    actual[2].keys.map((account) => account.pubkey),
    expectation.walletPublicKey,
    expectation.mintPublicKey,
    {
      name: expectation.config.name,
      symbol: expectation.config.ticker,
      metadataUri: expectation.metadataUri,
    },
  );
  const spendLimit = validatePumpBuyInstruction(
    actual[4].data,
    actual[4].keys.map((account) => account.pubkey),
    expectation.walletPublicKey,
    expectation.mintPublicKey,
    create,
  );
  if (
    actual[4].data.readBigUInt64LE(8) !== BigInt(expectation.quotedTokenAmount.toString()) ||
    spendLimit !== BigInt(expectation.maxQuoteAmount.toString())
  ) {
    throw new Error("Atomic launch buy quote mismatch");
  }
  const streamflowExpectation = createStreamflowInstructionExpectation({
    sender: expectation.walletPublicKey,
    mint: expectation.mintPublicKey,
    metadata: expectation.metadataPublicKey,
    amount: expectation.lockAmount,
    unlockTimestamp: expectation.unlockTimestamp,
    name: expectation.config.name,
  });
  validateStreamflowCreateInstruction(new TransactionInstruction({
    programId: actual[5].programId,
    data: actual[5].data,
    keys: [...streamflowExpectation.keys],
  }), streamflowExpectation);
  return transaction;
}

export async function buildAtomicLaunchTransaction(
  identity: AtomicLaunchIdentity,
  lookupTableAddress: PublicKey,
): Promise<AtomicLaunchBundle> {
  const connection = await getConnection();
  const plan = await buildQuotedPlan(connection, identity);
  const lookupAddresses = lookupAddressesForPlan(identity, plan);
  const lookupTable = await resolveExactLookupTable(
    connection,
    lookupTableAddress,
    identity.walletPublicKey,
    lookupAddresses,
  );
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const deactivate = AddressLookupTableProgram.deactivateLookupTable({
    lookupTable: lookupTableAddress,
    authority: identity.walletPublicKey,
  });
  const instructions = Object.freeze([...plan.instructions, deactivate]);
  const message = new TransactionMessage({
    payerKey: identity.walletPublicKey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions: [...instructions],
  }).compileToV0Message([lookupTable]);
  const txBytes = new VersionedTransaction(message).serialize();
  validateAtomicLaunchTransaction(txBytes, {
    ...identity,
    lookupTable,
    lookupAddresses,
    instructions,
    quotedTokenAmount: plan.quotedTokenAmount,
    maxQuoteAmount: plan.maxQuoteAmount,
    lockAmount: plan.lockAmount,
    unlockTimestamp: plan.unlockTimestamp,
    blockhash: latestBlockhash.blockhash,
  });
  return Object.freeze({
    txBytes,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    lookupTableAddress,
    addressHash: hashLookupAddresses(lookupAddresses),
    quotedTokenAmount: plan.quotedTokenAmount.toString(),
    maxQuoteAmount: plan.maxQuoteAmount.toString(),
    lockAmount: plan.lockAmount.toString(),
    unlockTimestamp: plan.unlockTimestamp,
    streamflowFeePercent: plan.streamflowFeePercent,
    messageHash: hashAtomicTransactionMessage(txBytes),
  });
}
