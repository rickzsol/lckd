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
import {
  DEFAULT_PRIORITY_FEE_MICROLAMPORTS,
  LOOKUP_SETUP_COMPUTE_UNIT_LIMIT,
  MEMO_PROGRAM_ID,
  PUMPFUN_PROGRAM_ID,
} from "./constants";
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
import { readU64LE } from "./u64";
import { buildLaunchFeeInstruction, type LaunchFeeTerms } from "./launchFee";
import {
  BUYBACK_BURN_LAMPORTS,
  BUYBACK_BURN_PROGRAM_ID,
  deriveBuybackBurnAuthority,
  validatePumpBuyExactQuoteInInstruction,
} from "./buybackBurn";
import { PUMP_AMM_PROGRAM_ID } from "@pump-fun/pump-swap-sdk";

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
  coSigner: PublicKey;
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
  protocolLookupTable?: AddressLookupTableAccount;
  protocolLookupAddresses?: readonly PublicKey[];
  blockhash: string;
  name: string;
  ticker: string;
  metadataUri: string;
  quotedTokenAmount: string;
  maxQuoteAmount: string;
  lockAmount: string;
  unlockTimestamp: number;
  fee: LaunchFeeTerms;
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
  if (expectation.coSigner.equals(expectation.wallet)) {
    throw new Error("Lookup table co-signer must be distinct from the launch wallet");
  }
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
  const legacyExpectedMessage = new TransactionMessage({
    payerKey: expectation.wallet,
    recentBlockhash: expectation.blockhash,
    instructions: [createInstruction, extendInstruction],
  }).compileToV0Message();
  const expectedMessage = new TransactionMessage({
    payerKey: expectation.wallet,
    recentBlockhash: expectation.blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: LOOKUP_SETUP_COMPUTE_UNIT_LIMIT }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: DEFAULT_PRIORITY_FEE_MICROLAMPORTS,
      }),
      new TransactionInstruction({
        programId: MEMO_PROGRAM_ID,
        keys: [{ pubkey: expectation.coSigner, isSigner: true, isWritable: false }],
        data: Buffer.alloc(0),
      }),
      createInstruction,
      extendInstruction,
    ],
  }).compileToV0Message();
  const pinnedOneSignerExpectedMessage = new TransactionMessage({
    payerKey: expectation.wallet,
    recentBlockhash: expectation.blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: LOOKUP_SETUP_COMPUTE_UNIT_LIMIT }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: DEFAULT_PRIORITY_FEE_MICROLAMPORTS,
      }),
      createInstruction,
      extendInstruction,
    ],
  }).compileToV0Message();
  const transaction = VersionedTransaction.deserialize(decodeBase64(transactionBase64));
  assertUnsigned(transaction);
  if (
    expectation.lastValidBlockHeight < 1 ||
    transaction.message.addressTableLookups.length !== 0 ||
    ![1, 2].includes(transaction.message.header.numRequiredSignatures) ||
    !transaction.message.staticAccountKeys[0]?.equals(expectation.wallet) ||
    ![expectedMessage, pinnedOneSignerExpectedMessage, legacyExpectedMessage].some((candidate) =>
      Buffer.from(transaction.message.serialize()).equals(Buffer.from(candidate.serialize())))
  ) {
    throw new Error("Lookup table setup transaction does not match the reviewed launch");
  }
  return transaction;
}

export function assertLookupSetupCoSigner(
  transaction: VersionedTransaction,
  coSigner: PublicKey,
): void {
  const requiredSigners = transaction.message.staticAccountKeys.slice(
    0,
    transaction.message.header.numRequiredSignatures,
  );
  if (!requiredSigners.some((signer) => signer.equals(coSigner))) {
    throw new Error("Legacy lookup setup must expire and be cleaned up before retrying");
  }
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
  const isBuybackBurn = expectation.fee.feeMode === "buybackBurn";
  if (isBuybackBurn) {
    const protocol = expectation.protocolLookupTable;
    const addresses = expectation.protocolLookupAddresses;
    if (
      !protocol || !addresses || protocol.state.deactivationSlot !== U64_MAX ||
      protocol.state.addresses.length !== addresses.length ||
      protocol.state.addresses.some((address, index) => !address.equals(addresses[index]))
    ) {
      throw new Error("Protocol lookup table does not match the reviewed address vector");
    }
  } else if (expectation.protocolLookupTable || expectation.protocolLookupAddresses) {
    throw new Error("Legacy atomic launch must not use a protocol lookup table");
  }
}

function decompile(
  transaction: VersionedTransaction,
  lookupTables: AddressLookupTableAccount[],
): TransactionInstruction[] {
  const keys = transaction.message.getAccountKeys({ addressLookupTableAccounts: lookupTables });
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

function validateBuybackBurnInstruction(
  instruction: TransactionInstruction,
  expectation: AtomicTransactionExpectation,
): void {
  const minimumBaseAmountOut = BigInt(expectation.fee.feeLckdRaw!);
  const authority = deriveBuybackBurnAuthority(BUYBACK_BURN_PROGRAM_ID);
  if (
    expectation.fee.feeLamports !== BUYBACK_BURN_LAMPORTS ||
    expectation.fee.feeTreasury !== authority.toBase58() ||
    !instruction.programId.equals(BUYBACK_BURN_PROGRAM_ID) ||
    instruction.keys.length !== 27 ||
    !instruction.keys[0].pubkey.equals(expectation.wallet) ||
    !instruction.keys[0].isSigner || !instruction.keys[0].isWritable ||
    instruction.data.length !== 9 || instruction.data[0] !== 0 ||
    instruction.data.readBigUInt64LE(1) !== minimumBaseAmountOut
  ) {
    throw new Error("Atomic buyback-and-burn instruction changed");
  }
  const pumpData = Buffer.alloc(25);
  Buffer.from([198, 46, 21, 82, 180, 217, 232, 112]).copy(pumpData);
  pumpData.writeBigUInt64LE(BigInt(BUYBACK_BURN_LAMPORTS), 8);
  pumpData.writeBigUInt64LE(minimumBaseAmountOut, 16);
  const pumpWritable = new Set([0, 1, 5, 6, 7, 8, 10, 17, 20, 25]);
  const pumpKeys = instruction.keys.slice(1).map((account, index) => ({
    ...account,
    isSigner: index === 1,
    isWritable: pumpWritable.has(index),
  }));
  validatePumpBuyExactQuoteInInstruction(new TransactionInstruction({
    programId: PUMP_AMM_PROGRAM_ID,
    keys: pumpKeys,
    data: pumpData,
  }), authority, minimumBaseAmountOut);
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
  const isBuybackBurn = expectation.fee.feeMode === "buybackBurn";
  const expectedLookupTables = isBuybackBurn
    ? [expectation.lookupTable, expectation.protocolLookupTable!]
    : [expectation.lookupTable];
  if (
    message.recentBlockhash !== expectation.blockhash ||
    message.addressTableLookups.length !== expectedLookupTables.length ||
    message.addressTableLookups.some((lookup, index) =>
      !lookup.accountKey.equals(expectedLookupTables[index].key)) ||
    signers.length !== expectedSigners.length ||
    signers.some((signer, index) => !signer.equals(expectedSigners[index]))
  ) {
    throw new Error("Atomic launch transaction envelope does not match the reviewed launch");
  }

  const instructions = decompile(transaction, expectedLookupTables);
  const expectedLimit = ComputeBudgetProgram.setComputeUnitLimit({
    units: ATOMIC_COMPUTE_UNIT_LIMIT,
  });
  const expectedPrice = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: DEFAULT_PRIORITY_FEE_MICROLAMPORTS,
  });
  const feeInstruction = isBuybackBurn
    ? instructions[6]
    : buildLaunchFeeInstruction(expectation.wallet, expectation.fee);
  if (isBuybackBurn) {
    if (!feeInstruction) throw new Error("Atomic buyback-and-burn instruction is missing");
    validateBuybackBurnInstruction(feeInstruction, expectation);
    const seen = new Set<string>();
    const expectedProtocolAddresses = feeInstruction.keys.slice(1)
      .map((account) => account.pubkey)
      .filter((address) => {
        const encoded = address.toBase58();
        if (seen.has(encoded)) return false;
        seen.add(encoded);
        return true;
      });
    if (
      expectedProtocolAddresses.length !== expectation.protocolLookupAddresses!.length ||
      expectedProtocolAddresses.some((address, index) =>
        !address.equals(expectation.protocolLookupAddresses![index]))
    ) {
      throw new Error("Atomic buyback protocol lookup vector changed");
    }
  }
  const expectedPrograms = [
    ComputeBudgetProgram.programId,
    ComputeBudgetProgram.programId,
    PUMPFUN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    PUMPFUN_PROGRAM_ID,
    STREAMFLOW_V13_PROGRAM_ID,
    ...(feeInstruction ? [feeInstruction.programId] : []),
    ...(!isBuybackBurn ? [AddressLookupTableProgram.programId] : []),
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
    ...(feeInstruction ? [feeInstruction] : []),
    ...(!isBuybackBurn ? [deactivate] : []),
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
    readU64LE(instructions[4].data, 8) !== BigInt(expectation.quotedTokenAmount) ||
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
  if (!isBuybackBurn) {
    const deactivateActual = instructions[instructions.length - 1];
    if (
      !deactivateActual.data.equals(deactivate.data) ||
      deactivateActual.keys.length !== deactivate.keys.length ||
      deactivateActual.keys.some((account, index) =>
        !account.pubkey.equals(deactivate.keys[index].pubkey))
    ) {
      throw new Error("Atomic launch lookup cleanup instruction changed");
    }
  }
  return transaction;
}
