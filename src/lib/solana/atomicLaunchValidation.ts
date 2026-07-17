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
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
} from "@solana/spl-token";
import {
  getBuyTokenAmountFromSolAmount,
  OnlinePumpSdk,
  PUMP_SDK,
} from "@pump-fun/pump-sdk";
import BN from "bn.js";
import { DEFAULT_PRIORITY_FEE_MICROLAMPORTS, PUMPFUN_PROGRAM_ID } from "./constants";
import { validatePumpBuyInstruction } from "./pumpBuyValidation";
import { validatePumpCreateInstruction } from "./pumpCreateValidation";
import {
  createStreamflowInstructionExpectation,
  STREAMFLOW_V13_PROGRAM_ID,
  validateStreamflowCreateInstruction,
} from "./streamflowInstruction";
import {
  calculateLockAmount,
  getConfirmedClusterTimestamp,
  getStreamflowTotalFeePercent,
  lockDaysToSeconds,
} from "./streamflow";

const ATOMIC_COMPUTE_UNIT_LIMIT = 400_000;
const U64_MAX = BigInt("0xffffffffffffffff");
const FEE_RECIPIENT = new PublicKey("62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV");
const BUYBACK_FEE_RECIPIENT = new PublicKey("5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD");
const LAMPORTS_PER_SOL = 1_000_000_000;
const SLIPPAGE_BPS = 1_000;
const UNLOCK_BUFFER_SECONDS = 120;
const MAX_CLUSTER_TIME_DRIFT_SECONDS = 60;

export interface ReviewedAtomicEconomics {
  quotedTokenAmount: string;
  maxQuoteAmount: string;
  lockAmount: string;
  clusterTimestamp: number;
  streamflowFeePercent: number;
}

export async function deriveReviewedAtomicEconomics(
  connection: Connection,
  config: { buyAmountSol: number; lockPercentage: number },
  wallet: PublicKey,
): Promise<ReviewedAtomicEconomics> {
  const buyLamports = Math.round(config.buyAmountSol * LAMPORTS_PER_SOL);
  if (!Number.isSafeInteger(buyLamports) || buyLamports < 1) {
    throw new Error("Reviewed atomic buy amount is invalid");
  }
  if (!Number.isInteger(config.lockPercentage) || config.lockPercentage < 51 || config.lockPercentage > 99) {
    throw new Error("Reviewed atomic lock percentage is invalid");
  }
  const onlineSdk = new OnlinePumpSdk(connection);
  const [global, feeConfig, clusterTimestamp, streamflowFeePercent] = await Promise.all([
    onlineSdk.fetchGlobal(),
    onlineSdk.fetchFeeConfig(),
    getConfirmedClusterTimestamp(connection),
    getStreamflowTotalFeePercent(connection, wallet),
  ]);
  const amount = new BN(buyLamports);
  const quoted = getBuyTokenAmountFromSolAmount({
    global,
    feeConfig,
    mintSupply: null,
    bondingCurve: null,
    amount,
    quoteMint: NATIVE_MINT,
  });
  const maxQuote = amount.muln(10_000 + SLIPPAGE_BPS).addn(9_999).divn(10_000);
  const quotedValue = BigInt(quoted.toString());
  const lockAmount = calculateLockAmount(
    quotedValue,
    config.lockPercentage,
    streamflowFeePercent,
  );
  return {
    quotedTokenAmount: quoted.toString(),
    maxQuoteAmount: maxQuote.toString(),
    lockAmount: lockAmount.toString(),
    clusterTimestamp,
    streamflowFeePercent,
  };
}

export function validateReviewedUnlockTimestamp(
  unlockTimestamp: number,
  clusterTimestamp: number,
  lockDurationDays: number,
): void {
  if (
    !Number.isSafeInteger(unlockTimestamp) ||
    !Number.isSafeInteger(clusterTimestamp) ||
    !Number.isInteger(lockDurationDays)
  ) {
    throw new Error("Reviewed atomic unlock time is invalid");
  }
  const delta = unlockTimestamp - clusterTimestamp;
  const expected = lockDaysToSeconds(lockDurationDays) + UNLOCK_BUFFER_SECONDS;
  if (
    delta < expected - MAX_CLUSTER_TIME_DRIFT_SECONDS ||
    delta > expected + MAX_CLUSTER_TIME_DRIFT_SECONDS
  ) {
    throw new Error("Atomic unlock time changed from the reviewed duration");
  }
}

export interface LookupSetupExpectation {
  wallet: PublicKey;
  lookupTable: PublicKey;
  addresses: readonly PublicKey[];
  recentSlot: number;
  blockhash: string;
  lastValidBlockHeight: number;
}

export interface AtomicTransactionExpectation {
  wallet: PublicKey;
  mint: PublicKey;
  metadata: PublicKey;
  lookupTable: AddressLookupTableAccount;
  lookupAddresses: readonly PublicKey[];
  blockhash: string;
  name: string;
  ticker: string;
  metadataUri: string;
  quotedTokenAmount: string;
  maxQuoteAmount: string;
  lockAmount: string;
  unlockTimestamp: number;
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function assertUnsigned(transaction: VersionedTransaction): void {
  if (transaction.signatures.some((signature) => signature.some((byte) => byte !== 0))) {
    throw new Error("Server transaction unexpectedly contains a signature");
  }
}

export function validateLookupSetupTransaction(
  transactionBase64: string,
  expectation: LookupSetupExpectation,
): VersionedTransaction {
  const [createInstruction, derivedLookupTable] = AddressLookupTableProgram.createLookupTable({
    authority: expectation.wallet,
    payer: expectation.wallet,
    recentSlot: expectation.recentSlot,
  });
  if (!derivedLookupTable.equals(expectation.lookupTable)) {
    throw new Error("Lookup table address does not match its setup transaction");
  }
  const extendInstruction = AddressLookupTableProgram.extendLookupTable({
    authority: expectation.wallet,
    payer: expectation.wallet,
    lookupTable: expectation.lookupTable,
    addresses: [...expectation.addresses],
  });
  const expectedMessage = new TransactionMessage({
    payerKey: expectation.wallet,
    recentBlockhash: expectation.blockhash,
    instructions: [createInstruction, extendInstruction],
  }).compileToV0Message();
  const transaction = VersionedTransaction.deserialize(decodeBase64(transactionBase64));
  assertUnsigned(transaction);
  if (
    expectation.lastValidBlockHeight < 1 ||
    transaction.message.addressTableLookups.length !== 0 ||
    transaction.message.header.numRequiredSignatures !== 1 ||
    !transaction.message.staticAccountKeys[0]?.equals(expectation.wallet) ||
    !Buffer.from(transaction.message.serialize()).equals(Buffer.from(expectedMessage.serialize()))
  ) {
    throw new Error("Lookup table setup transaction does not match the reviewed launch");
  }
  return transaction;
}

function assertExactLookupTable(expectation: AtomicTransactionExpectation): void {
  const { lookupTable, lookupAddresses, wallet } = expectation;
  if (
    !lookupTable.state.authority?.equals(wallet) ||
    lookupTable.state.deactivationSlot !== U64_MAX ||
    lookupTable.state.addresses.length !== lookupAddresses.length ||
    lookupTable.state.addresses.some((address, index) => !address.equals(lookupAddresses[index]))
  ) {
    throw new Error("Active lookup table does not match the reviewed address vector");
  }
}

function decompile(
  transaction: VersionedTransaction,
  lookupTable: AddressLookupTableAccount,
): TransactionInstruction[] {
  const keys = transaction.message.getAccountKeys({ addressLookupTableAccounts: [lookupTable] });
  return transaction.message.compiledInstructions.map((instruction) => {
    const programId = keys.get(instruction.programIdIndex);
    if (!programId) throw new Error("Atomic launch program cannot be resolved");
    return new TransactionInstruction({
      programId,
      data: Buffer.from(instruction.data),
      keys: [...instruction.accountKeyIndexes].map((index) => {
        const pubkey = keys.get(index);
        if (!pubkey) throw new Error("Atomic launch account cannot be resolved");
        return {
          pubkey,
          isSigner: transaction.message.isAccountSigner(index),
          isWritable: transaction.message.isAccountWritable(index),
        };
      }),
    });
  });
}

function expectedPrivileges(
  payer: PublicKey,
  instructions: readonly TransactionInstruction[],
): ReadonlyMap<string, { isSigner: boolean; isWritable: boolean }> {
  const privileges = new Map<string, { isSigner: boolean; isWritable: boolean }>([
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

function assertExactInstructions(
  actual: readonly TransactionInstruction[],
  expected: readonly TransactionInstruction[],
  payer: PublicKey,
): void {
  const privileges = expectedPrivileges(payer, expected);
  if (actual.length !== expected.length) throw new Error("Atomic launch instruction count changed");
  actual.forEach((instruction, instructionIndex) => {
    const exact = expected[instructionIndex];
    if (
      !exact ||
      !instruction.programId.equals(exact.programId) ||
      !instruction.data.equals(exact.data) ||
      instruction.keys.length !== exact.keys.length ||
      instruction.keys.some((account, accountIndex) => {
        const exactAccount = exact.keys[accountIndex];
        const privilege = privileges.get(account.pubkey.toBase58());
        return !exactAccount || !privilege || !account.pubkey.equals(exactAccount.pubkey) ||
          account.isSigner !== privilege.isSigner || account.isWritable !== privilege.isWritable;
      })
    ) {
      throw new Error("Atomic launch resolved instruction changed");
    }
  });
}

export async function validateAtomicLaunchTransactionClient(
  transactionBase64: string,
  expectation: AtomicTransactionExpectation,
): Promise<VersionedTransaction> {
  assertExactLookupTable(expectation);
  const bytes = decodeBase64(transactionBase64);
  if (bytes.length > 1_232) throw new Error("Atomic launch transaction exceeds packet size");
  const transaction = VersionedTransaction.deserialize(bytes);
  assertUnsigned(transaction);
  const message = transaction.message;
  const signers = message.staticAccountKeys.slice(0, message.header.numRequiredSignatures);
  const expectedSigners = [expectation.wallet, expectation.mint, expectation.metadata];
  if (
    message.recentBlockhash !== expectation.blockhash ||
    message.addressTableLookups.length !== 1 ||
    !message.addressTableLookups[0]?.accountKey.equals(expectation.lookupTable.key) ||
    signers.length !== expectedSigners.length ||
    signers.some((signer, index) => !signer.equals(expectedSigners[index]))
  ) {
    throw new Error("Atomic launch transaction envelope does not match the reviewed launch");
  }

  const instructions = decompile(transaction, expectation.lookupTable);
  const expectedLimit = ComputeBudgetProgram.setComputeUnitLimit({
    units: ATOMIC_COMPUTE_UNIT_LIMIT,
  });
  const expectedPrice = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: DEFAULT_PRIORITY_FEE_MICROLAMPORTS,
  });
  const expectedPrograms = [
    ComputeBudgetProgram.programId,
    ComputeBudgetProgram.programId,
    PUMPFUN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    PUMPFUN_PROGRAM_ID,
    STREAMFLOW_V13_PROGRAM_ID,
    AddressLookupTableProgram.programId,
  ];
  if (
    instructions.length !== expectedPrograms.length ||
    instructions.some((instruction, index) => !instruction.programId.equals(expectedPrograms[index])) ||
    !instructions[0].data.equals(expectedLimit.data) ||
    !instructions[1].data.equals(expectedPrice.data)
  ) {
    throw new Error("Atomic launch instruction sequence is invalid");
  }

  const associatedUser = getAssociatedTokenAddressSync(
    expectation.mint,
    expectation.wallet,
    false,
    TOKEN_PROGRAM_ID,
  );
  const expectedAta = createAssociatedTokenAccountIdempotentInstruction(
    expectation.wallet,
    associatedUser,
    expectation.wallet,
    expectation.mint,
    TOKEN_PROGRAM_ID,
  );
  const lockExpectation = createStreamflowInstructionExpectation({
    sender: expectation.wallet,
    mint: expectation.mint,
    metadata: expectation.metadata,
    amount: new BN(expectation.lockAmount),
    unlockTimestamp: expectation.unlockTimestamp,
    name: expectation.name,
  });
  const deactivate = AddressLookupTableProgram.deactivateLookupTable({
    lookupTable: expectation.lookupTable.key,
    authority: expectation.wallet,
  });
  const expectedInstructions = [
    expectedLimit,
    expectedPrice,
    await PUMP_SDK.createInstruction({
      mint: expectation.mint,
      name: expectation.name,
      symbol: expectation.ticker,
      uri: expectation.metadataUri,
      creator: expectation.wallet,
      user: expectation.wallet,
    }),
    expectedAta,
    await PUMP_SDK.getBuyInstructionRaw({
      user: expectation.wallet,
      mint: expectation.mint,
      creator: expectation.wallet,
      amount: new BN(expectation.quotedTokenAmount),
      solAmount: new BN(expectation.maxQuoteAmount),
      feeRecipient: FEE_RECIPIENT,
      buybackFeeRecipient: BUYBACK_FEE_RECIPIENT,
      tokenProgram: TOKEN_PROGRAM_ID,
    }),
    new TransactionInstruction({
      programId: lockExpectation.programId,
      data: lockExpectation.data,
      keys: [...lockExpectation.keys],
    }),
    deactivate,
  ];
  assertExactInstructions(instructions, expectedInstructions, expectation.wallet);

  const create = validatePumpCreateInstruction(
    instructions[2].data,
    instructions[2].keys.map((account) => account.pubkey),
    expectation.wallet,
    expectation.mint,
    {
      name: expectation.name,
      symbol: expectation.ticker,
      metadataUri: expectation.metadataUri,
    },
  );
  const maxQuoteAmount = validatePumpBuyInstruction(
    instructions[4].data,
    instructions[4].keys.map((account) => account.pubkey),
    expectation.wallet,
    expectation.mint,
    create,
  );
  if (
    instructions[4].data.readBigUInt64LE(8) !== BigInt(expectation.quotedTokenAmount) ||
    maxQuoteAmount !== BigInt(expectation.maxQuoteAmount)
  ) {
    throw new Error("Atomic launch buy quote changed");
  }
  if (
    !instructions[3].data.equals(expectedAta.data) ||
    instructions[3].keys.length !== expectedAta.keys.length ||
    instructions[3].keys.some((account, index) =>
      !account.pubkey.equals(expectedAta.keys[index].pubkey))
  ) {
    throw new Error("Atomic launch token account instruction changed");
  }
  if (
    instructions[5].keys.length !== lockExpectation.keys.length ||
    instructions[5].keys.some((account, index) =>
      !account.pubkey.equals(lockExpectation.keys[index].pubkey))
  ) {
    throw new Error("Atomic launch Streamflow accounts changed");
  }
  validateStreamflowCreateInstruction(new TransactionInstruction({
    programId: instructions[5].programId,
    data: instructions[5].data,
    keys: [...lockExpectation.keys],
  }), lockExpectation);
  if (
    !instructions[6].data.equals(deactivate.data) ||
    instructions[6].keys.length !== deactivate.keys.length ||
    instructions[6].keys.some((account, index) =>
      !account.pubkey.equals(deactivate.keys[index].pubkey))
  ) {
    throw new Error("Atomic launch lookup cleanup instruction changed");
  }
  return transaction;
}
