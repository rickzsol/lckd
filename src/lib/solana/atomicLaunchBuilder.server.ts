import "server-only";

import { createHash } from "node:crypto";
import {
  getBuyTokenAmountFromSolAmount,
  OnlinePumpSdk,
  PUMP_SDK,
} from "@pump-fun/pump-sdk";
import {
  GLOBAL_CONFIG_PDA,
  GLOBAL_VOLUME_ACCUMULATOR_PDA,
  PUMP_AMM_EVENT_AUTHORITY_PDA,
  PUMP_AMM_FEE_CONFIG_PDA,
  PUMP_AMM_PROGRAM_ID,
  PUMP_FEE_PROGRAM_ID,
  poolV2Pda,
  userVolumeAccumulatorPda,
} from "@pump-fun/pump-swap-sdk";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
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
  resolveProtocolLookupTable,
  validateExactLookupTable,
  validateProtocolLookupTable,
  validateLookupTablePreparation,
  type LookupTablePreparation,
} from "./lookupTable";
import {
  BUYBACK_BURN_LAMPORTS,
  BUYBACK_BURN_PROGRAM_ID,
  LCKD_CANONICAL_PUMP_POOL,
  LCKD_MINT,
  PUMP_BUYBACK_FEE_RECIPIENT,
  PUMP_CREATOR_VAULT_AUTHORITY,
  PUMP_PROTOCOL_FEE_RECIPIENT,
  deriveBuybackBurnAtas,
  deriveBuybackBurnAuthority,
  validatePumpBuyExactQuoteInInstruction,
  wrapBuybackBurnInstruction,
} from "./buybackBurn";
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
import {
  assertLaunchFeeTerms,
  buildLaunchFeeInstruction,
  launchFeeTermsFromConfig,
  type LaunchFeeTerms,
} from "./launchFee";

const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const ATOMIC_COMPUTE_UNIT_LIMIT = 400_000;
export const LOCK_SUBMISSION_BUFFER_SECONDS = 120;
const CONFIG_KEYS = [
  "name",
  "ticker",
  "buyAmountSol",
  "lockDurationDays",
  "lockPercentage",
  "feeMode",
  "feeLamports",
  "feeLckdRaw",
  "feeTreasury",
] as const;

export interface FrozenAtomicLaunchConfig extends LaunchFeeTerms {
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

export interface IssuedLookupPreparation {
  transaction: Uint8Array;
  lookupTableAddress: PublicKey;
  addresses: readonly PublicKey[];
  recentSlot: number;
  messageHash: string;
  blockhash: string;
  lastValidBlockHeight: number;
  plan: AtomicLaunchPlanSnapshot;
}

export interface AtomicLaunchPlanSnapshot {
  quotedTokenAmount: string;
  maxQuoteAmount: string;
  lockAmount: string;
  unlockTimestamp: number;
  streamflowFeePercent: number;
}

export interface IssuedAtomicLaunchTransaction {
  transaction: Uint8Array;
  messageHash: string;
  blockhash: string;
  lastValidBlockHeight: number;
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
  protocolLookupTableAddress?: PublicKey;
  protocolLookupAddresses?: readonly PublicKey[];
  protocolAddressHash?: string;
}

export interface AtomicLaunchValidationExpectation extends AtomicLaunchIdentity {
  lookupTable: AddressLookupTableAccount;
  lookupAddresses: readonly PublicKey[];
  protocolLookupTable?: AddressLookupTableAccount;
  protocolLookupAddresses?: readonly PublicKey[];
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
  config: Pick<LaunchConfig, "name" | "ticker" | "buyAmountSol" | "lockDurationDays" | "lockPercentage"> &
    Partial<LaunchFeeTerms>,
): FrozenAtomicLaunchConfig {
  const feeTerms = launchFeeTermsFromConfig(config as Record<string, unknown>);
  const frozen = Object.freeze({
    name: config.name,
    ticker: config.ticker,
    buyAmountSol: config.buyAmountSol,
    lockDurationDays: config.lockDurationDays,
    lockPercentage: config.lockPercentage,
    feeMode: feeTerms.feeMode,
    feeLamports: feeTerms.feeLamports,
    feeLckdRaw: feeTerms.feeLckdRaw,
    feeTreasury: feeTerms.feeTreasury,
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
  assertLaunchFeeTerms(config);
  if (config.feeMode === "buybackBurn") {
    const authority = deriveBuybackBurnAuthority(BUYBACK_BURN_PROGRAM_ID);
    if (config.feeTreasury !== authority.toBase58()) {
      throw new Error("Buyback-and-burn fee treasury is not the canonical program PDA");
    }
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

function buildFrozenBuybackBurnInstruction(
  launcher: PublicKey,
  terms: LaunchFeeTerms,
): TransactionInstruction {
  assertLaunchFeeTerms(terms);
  if (terms.feeMode !== "buybackBurn") {
    throw new Error("Buyback-and-burn fee mode is required");
  }
  const authority = deriveBuybackBurnAuthority(BUYBACK_BURN_PROGRAM_ID);
  if (terms.feeTreasury !== authority.toBase58()) {
    throw new Error("Buyback-and-burn authority changed");
  }
  const minimumBaseAmountOut = BigInt(terms.feeLckdRaw!);
  const authorityAtas = deriveBuybackBurnAtas(authority);
  const poolLckd = getAssociatedTokenAddressSync(
    LCKD_MINT,
    LCKD_CANONICAL_PUMP_POOL,
    true,
    TOKEN_2022_PROGRAM_ID,
  );
  const poolWsol = getAssociatedTokenAddressSync(NATIVE_MINT, LCKD_CANONICAL_PUMP_POOL, true);
  const pumpInstruction = new TransactionInstruction({
    programId: PUMP_AMM_PROGRAM_ID,
    keys: [
      meta(LCKD_CANONICAL_PUMP_POOL, false, true), meta(authority, true, true),
      meta(GLOBAL_CONFIG_PDA), meta(LCKD_MINT), meta(NATIVE_MINT),
      meta(authorityAtas.lckd, false, true), meta(authorityAtas.wsol, false, true),
      meta(poolLckd, false, true), meta(poolWsol, false, true), meta(PUMP_PROTOCOL_FEE_RECIPIENT),
      meta(getAssociatedTokenAddressSync(NATIVE_MINT, PUMP_PROTOCOL_FEE_RECIPIENT, true), false, true),
      meta(TOKEN_2022_PROGRAM_ID), meta(TOKEN_PROGRAM_ID), meta(SystemProgram.programId),
      meta(ASSOCIATED_TOKEN_PROGRAM_ID), meta(PUMP_AMM_EVENT_AUTHORITY_PDA),
      meta(PUMP_AMM_PROGRAM_ID),
      meta(getAssociatedTokenAddressSync(NATIVE_MINT, PUMP_CREATOR_VAULT_AUTHORITY, true), false, true),
      meta(PUMP_CREATOR_VAULT_AUTHORITY), meta(GLOBAL_VOLUME_ACCUMULATOR_PDA),
      meta(userVolumeAccumulatorPda(authority), false, true), meta(PUMP_AMM_FEE_CONFIG_PDA),
      meta(PUMP_FEE_PROGRAM_ID), meta(poolV2Pda(LCKD_MINT)), meta(PUMP_BUYBACK_FEE_RECIPIENT),
      meta(getAssociatedTokenAddressSync(NATIVE_MINT, PUMP_BUYBACK_FEE_RECIPIENT, true), false, true),
    ],
    data: encodePumpBuybackData(minimumBaseAmountOut),
  });
  validatePumpBuyExactQuoteInInstruction(pumpInstruction, authority, minimumBaseAmountOut);
  return wrapBuybackBurnInstruction({
    programId: BUYBACK_BURN_PROGRAM_ID,
    launcher,
    authority,
    pumpInstruction,
    minimumBaseAmountOut,
  });
}

function encodePumpBuybackData(minimumBaseAmountOut: bigint): Buffer {
  const data = Buffer.alloc(25);
  Buffer.from([198, 46, 21, 82, 180, 217, 232, 112]).copy(data);
  data.writeBigUInt64LE(BigInt(BUYBACK_BURN_LAMPORTS), 8);
  data.writeBigUInt64LE(minimumBaseAmountOut, 16);
  return data;
}

function meta(pubkey: PublicKey, isSigner = false, isWritable = false) {
  return { pubkey, isSigner, isWritable };
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
      feeRecipient: PUMP_PROTOCOL_FEE_RECIPIENT,
      buybackFeeRecipient: PUMP_BUYBACK_FEE_RECIPIENT,
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
  const feeInstruction = identity.config.feeMode === "buybackBurn"
    ? buildFrozenBuybackBurnInstruction(identity.walletPublicKey, identity.config)
    : buildLaunchFeeInstruction(identity.walletPublicKey, identity.config);
  if (feeInstruction) instructions.push(feeInstruction);
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
  const addresses = canonicalLookupAddresses(plan.instructions, [
    identity.walletPublicKey,
    identity.mintPublicKey,
    identity.metadataPublicKey,
  ]);
  if (identity.config.feeMode !== "buybackBurn") return addresses;
  const protocolSet = new Set(
    buybackProtocolLookupAddresses(plan, identity.walletPublicKey).map((key) => key.toBase58()),
  );
  return Object.freeze(addresses.filter((address) => !protocolSet.has(address.toBase58())));
}

export function buybackProtocolLookupAddresses(
  plan: AtomicInstructionPlan,
  wallet: PublicKey,
): readonly PublicKey[] {
  const instruction = plan.instructions.find((candidate) =>
    candidate.programId.equals(BUYBACK_BURN_PROGRAM_ID));
  if (!instruction) throw new Error("Buyback-and-burn instruction is missing");
  return canonicalLookupAddresses([instruction], [wallet]);
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
    coSigner: identity.metadataPublicKey,
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

function assertUnsignedTransaction(transaction: VersionedTransaction, label: string): void {
  if (transaction.signatures.some((signature) => signature.some((byte) => byte !== 0))) {
    throw new Error(`${label} unexpectedly contains a signature`);
  }
}

export async function buildAtomicLaunchInstructionsFromSnapshot(
  identity: AtomicLaunchIdentity,
  snapshot: AtomicLaunchPlanSnapshot,
): Promise<AtomicInstructionPlan> {
  if (
    !/^\d+$/.test(snapshot.quotedTokenAmount) ||
    !/^\d+$/.test(snapshot.maxQuoteAmount) ||
    !/^\d+$/.test(snapshot.lockAmount) ||
    !Number.isSafeInteger(snapshot.unlockTimestamp) || snapshot.unlockTimestamp < 1 ||
    !Number.isFinite(snapshot.streamflowFeePercent) ||
    snapshot.streamflowFeePercent < 0 || snapshot.streamflowFeePercent >= 100
  ) {
    throw new Error("Atomic launch plan snapshot is invalid");
  }
  const plan = await buildAtomicLaunchInstructions(identity, {
    quotedTokenAmount: new BN(snapshot.quotedTokenAmount),
    maxQuoteAmount: new BN(snapshot.maxQuoteAmount),
    streamflowFeePercent: snapshot.streamflowFeePercent,
    unlockTimestamp: snapshot.unlockTimestamp,
  });
  if (plan.lockAmount.toString() !== snapshot.lockAmount) {
    throw new Error("Atomic launch plan lock amount changed");
  }
  return plan;
}

export async function rebuildIssuedAtomicLookupPreparation(
  identity: AtomicLaunchIdentity,
  issued: IssuedLookupPreparation,
): Promise<AtomicLookupPreparationBundle> {
  const plan = await buildAtomicLaunchInstructionsFromSnapshot(identity, issued.plan);
  const expectedAddresses = lookupAddressesForPlan(identity, plan);
  if (
    expectedAddresses.length !== issued.addresses.length ||
    expectedAddresses.some((address, index) => !address.equals(issued.addresses[index]))
  ) {
    throw new Error("Replayed atomic setup address vector changed");
  }
  const params = {
    authority: identity.walletPublicKey,
    payer: identity.walletPublicKey,
    coSigner: identity.metadataPublicKey,
    addresses: issued.addresses,
    recentSlot: issued.recentSlot,
    blockhash: issued.blockhash,
    lastValidBlockHeight: issued.lastValidBlockHeight,
  };
  const lookupTableAddress = validateLookupTablePreparation(issued.transaction, params);
  const transaction = VersionedTransaction.deserialize(issued.transaction);
  assertUnsignedTransaction(transaction, "Replayed atomic setup");
  const messageHash = hashAtomicTransactionMessage(issued.transaction);
  if (
    messageHash !== issued.messageHash ||
    !lookupTableAddress.equals(issued.lookupTableAddress) ||
    hashLookupAddresses(issued.addresses) !== hashLookupAddresses(expectedAddresses)
  ) {
    throw new Error("Replayed atomic setup does not match server issuance");
  }
  return Object.freeze({
    lookupTableAddress,
    addressHash: hashLookupAddresses(issued.addresses),
    addresses: Object.freeze([...issued.addresses]),
    transaction: Uint8Array.from(issued.transaction),
    recentSlot: issued.recentSlot,
    blockhash: issued.blockhash,
    lastValidBlockHeight: issued.lastValidBlockHeight,
    quotedTokenAmount: plan.quotedTokenAmount.toString(),
    maxQuoteAmount: plan.maxQuoteAmount.toString(),
    lockAmount: plan.lockAmount.toString(),
    unlockTimestamp: plan.unlockTimestamp,
    streamflowFeePercent: plan.streamflowFeePercent,
    messageHash,
  });
}

function decompileInstruction(
  transaction: VersionedTransaction,
  lookupTables: AddressLookupTableAccount[],
  index: number,
): TransactionInstruction {
  const message = transaction.message;
  const instruction = message.compiledInstructions[index];
  if (!instruction) throw new Error("Atomic launch instruction is missing");
  const accountKeys = message.getAccountKeys({ addressLookupTableAccounts: lookupTables });
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
  const isBuybackBurn = expectation.config.feeMode === "buybackBurn";
  const protocolLookupTable = expectation.protocolLookupTable;
  const protocolLookupAddresses = expectation.protocolLookupAddresses;
  if (isBuybackBurn) {
    if (!protocolLookupTable || !protocolLookupAddresses) {
      throw new Error("Buyback protocol lookup table is required");
    }
    validateProtocolLookupTable(
      protocolLookupTable,
      protocolLookupTable.key,
      protocolLookupAddresses,
      protocolLookupTable.state.lastExtendedSlot + 1,
    );
  } else if (protocolLookupTable || protocolLookupAddresses) {
    throw new Error("Legacy atomic launch must not use a protocol lookup table");
  }
  const transaction = VersionedTransaction.deserialize(txBytes);
  const message = transaction.message;
  const signers = message.staticAccountKeys.slice(0, message.header.numRequiredSignatures);
  const expectedSigners = [
    expectation.walletPublicKey,
    expectation.mintPublicKey,
    expectation.metadataPublicKey,
  ];
  const expectedInstructionCount = isBuybackBurn || expectation.config.feeMode === "waived" ? 7 : 8;
  const expectedLookupTables = isBuybackBurn
    ? [expectation.lookupTable, protocolLookupTable!]
    : [expectation.lookupTable];
  if (
    message.addressTableLookups.length !== expectedLookupTables.length ||
    message.addressTableLookups.some((lookup, index) =>
      !lookup.accountKey.equals(expectedLookupTables[index].key)) ||
    message.recentBlockhash !== expectation.blockhash ||
    signers.length !== expectedSigners.length ||
    signers.some((signer, index) => !signer.equals(expectedSigners[index])) ||
    expectation.instructions.length !== expectedInstructionCount ||
    message.compiledInstructions.length !== expectedInstructionCount
  ) {
    throw new Error("Atomic launch transaction envelope mismatch");
  }
  const actual = message.compiledInstructions.map((_, index) =>
    decompileInstruction(transaction, expectedLookupTables, index));
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
  snapshot: AtomicLaunchPlanSnapshot,
  issued?: IssuedAtomicLaunchTransaction,
): Promise<AtomicLaunchBundle> {
  const isBuybackBurn = identity.config.feeMode === "buybackBurn";
  let configuredProtocolLookupTable: PublicKey | undefined;
  if (isBuybackBurn) {
    const configuredAddress = process.env.BUYBACK_BURN_LOOKUP_TABLE;
    if (!configuredAddress) throw new Error("Buyback-and-burn construction is unavailable");
    try {
      configuredProtocolLookupTable = new PublicKey(configuredAddress);
    } catch {
      throw new Error("Buyback-and-burn lookup table configuration is invalid");
    }
  }
  const connection = await getConnection();
  const plan = await buildAtomicLaunchInstructionsFromSnapshot(identity, snapshot);
  const lookupAddresses = lookupAddressesForPlan(identity, plan);
  const lookupTable = await resolveExactLookupTable(
    connection,
    lookupTableAddress,
    identity.walletPublicKey,
    lookupAddresses,
  );
  const protocolLookupAddresses = isBuybackBurn
    ? buybackProtocolLookupAddresses(plan, identity.walletPublicKey)
    : undefined;
  let protocolLookupTable: AddressLookupTableAccount | undefined;
  if (isBuybackBurn) {
    protocolLookupTable = await resolveProtocolLookupTable(
      connection,
      configuredProtocolLookupTable!,
      protocolLookupAddresses!,
    );
  }
  const instructions = isBuybackBurn
    ? Object.freeze([...plan.instructions])
    : Object.freeze([...plan.instructions, AddressLookupTableProgram.deactivateLookupTable({
      lookupTable: lookupTableAddress,
      authority: identity.walletPublicKey,
    })]);
  const latestBlockhash = issued
    ? { blockhash: issued.blockhash, lastValidBlockHeight: issued.lastValidBlockHeight }
    : await connection.getLatestBlockhash("confirmed");
  const txBytes = issued?.transaction ?? new VersionedTransaction(new TransactionMessage({
    payerKey: identity.walletPublicKey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions: [...instructions],
  }).compileToV0Message([
    lookupTable,
    ...(protocolLookupTable ? [protocolLookupTable] : []),
  ])).serialize();
  validateAtomicLaunchTransaction(txBytes, {
    ...identity,
    lookupTable,
    lookupAddresses,
    protocolLookupTable,
    protocolLookupAddresses,
    instructions,
    quotedTokenAmount: plan.quotedTokenAmount,
    maxQuoteAmount: plan.maxQuoteAmount,
    lockAmount: plan.lockAmount,
    unlockTimestamp: plan.unlockTimestamp,
    blockhash: latestBlockhash.blockhash,
  });
  assertUnsignedTransaction(VersionedTransaction.deserialize(txBytes), "Atomic launch transaction");
  const messageHash = hashAtomicTransactionMessage(txBytes);
  if (issued && messageHash !== issued.messageHash) {
    throw new Error("Replayed atomic transaction does not match server issuance");
  }
  return Object.freeze({
    txBytes: Uint8Array.from(txBytes),
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    lookupTableAddress,
    addressHash: hashLookupAddresses(lookupAddresses),
    quotedTokenAmount: plan.quotedTokenAmount.toString(),
    maxQuoteAmount: plan.maxQuoteAmount.toString(),
    lockAmount: plan.lockAmount.toString(),
    unlockTimestamp: plan.unlockTimestamp,
    streamflowFeePercent: plan.streamflowFeePercent,
    messageHash,
    protocolLookupTableAddress: protocolLookupTable?.key,
    protocolLookupAddresses: protocolLookupAddresses
      ? Object.freeze([...protocolLookupAddresses])
      : undefined,
    protocolAddressHash: protocolLookupAddresses
      ? hashLookupAddresses(protocolLookupAddresses)
      : undefined,
  });
}
