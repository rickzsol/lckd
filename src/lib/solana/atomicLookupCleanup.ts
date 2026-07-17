import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AccountInfo,
  type MessageV0,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import { DEFAULT_PRIORITY_FEE_MICROLAMPORTS } from "./constants";

export const LOOKUP_TABLE_ACTIVE_SLOT = BigInt("0xffffffffffffffff");
const LOOKUP_CLEANUP_COMPUTE_UNIT_LIMIT = 25_000;
const MAX_LOOKUP_CLEANUP_COMPUTE_UNIT_LIMIT = BigInt(100_000);
const MAX_LOOKUP_CLEANUP_COMPUTE_UNIT_PRICE = BigInt(1_000_000);
const MAX_LOOKUP_CLEANUP_PRIORITY_FEE_LAMPORTS = BigInt(100_000);
const MAX_LOOKUP_CLEANUP_LOADED_ACCOUNTS_BYTES = BigInt(64 * 1024 * 1024);

export type LookupCleanupPhase = "deactivate" | "close";

export interface LookupCleanupExpectation {
  phase: LookupCleanupPhase;
  wallet: PublicKey;
  lookupTable: PublicKey;
  blockhash: string;
}

export interface ExactLookupTableExpectation {
  wallet: PublicKey;
  lookupTable: PublicKey;
  addresses: readonly PublicKey[];
  currentSlot: number;
}

function cleanupInstruction(expectation: LookupCleanupExpectation) {
  return expectation.phase === "deactivate"
    ? AddressLookupTableProgram.deactivateLookupTable({
        authority: expectation.wallet,
        lookupTable: expectation.lookupTable,
      })
    : AddressLookupTableProgram.closeLookupTable({
        authority: expectation.wallet,
        lookupTable: expectation.lookupTable,
        recipient: expectation.wallet,
      });
}

export function buildLookupCleanupTransaction(
  expectation: LookupCleanupExpectation,
): VersionedTransaction {
  return buildCleanupTransaction(expectation, true);
}

function buildCleanupTransaction(
  expectation: LookupCleanupExpectation,
  isFeePinned: boolean,
): VersionedTransaction {
  const instructions = isFeePinned
    ? [
        ComputeBudgetProgram.setComputeUnitLimit({ units: LOOKUP_CLEANUP_COMPUTE_UNIT_LIMIT }),
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: DEFAULT_PRIORITY_FEE_MICROLAMPORTS,
        }),
        cleanupInstruction(expectation),
      ]
    : [cleanupInstruction(expectation)];
  const message = new TransactionMessage({
    payerKey: expectation.wallet,
    recentBlockhash: expectation.blockhash,
    instructions,
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

export function buildLegacyLookupCleanupTransaction(
  expectation: LookupCleanupExpectation,
): VersionedTransaction {
  return buildCleanupTransaction(expectation, false);
}

function resolveInstruction(message: MessageV0, index: number): TransactionInstruction {
  const compiled = message.compiledInstructions[index];
  if (!compiled) throw new Error("Lookup table cleanup instruction is missing");
  const programId = message.staticAccountKeys[compiled.programIdIndex];
  if (!programId) throw new Error("Lookup table cleanup program is missing");
  return new TransactionInstruction({
    programId,
    data: Buffer.from(compiled.data),
    keys: [...compiled.accountKeyIndexes].map((accountIndex) => {
      const pubkey = message.staticAccountKeys[accountIndex];
      if (!pubkey) throw new Error("Lookup table cleanup account is missing");
      return {
        pubkey,
        isSigner: message.isAccountSigner(accountIndex),
        isWritable: message.isAccountWritable(accountIndex),
      };
    }),
  });
}

function readLittleEndian(data: Uint8Array, offset: number, length: number): bigint {
  let value = BigInt(0);
  for (let index = offset + length - 1; index >= offset; index -= 1) {
    value = value * BigInt(256) + BigInt(data[index]);
  }
  return value;
}

function validateComputeBudgetPrefix(instructions: readonly TransactionInstruction[]): void {
  if (![0, 2, 3].includes(instructions.length)) {
    throw new Error("Lookup table cleanup compute budget is invalid");
  }
  let unitLimit: bigint | null = null;
  let unitPrice: bigint | null = null;
  let loadedAccountsBytes: bigint | null = null;
  for (const instruction of instructions) {
    const data = instruction.data;
    if (!instruction.programId.equals(ComputeBudgetProgram.programId) || instruction.keys.length) {
      throw new Error("Lookup table cleanup contains an unexpected program");
    }
    if (data.length === 5 && data[0] === 2 && unitLimit === null) {
      unitLimit = readLittleEndian(data, 1, 4);
    } else if (data.length === 9 && data[0] === 3 && unitPrice === null) {
      unitPrice = readLittleEndian(data, 1, 8);
    } else if (data.length === 5 && data[0] === 4 && loadedAccountsBytes === null) {
      loadedAccountsBytes = readLittleEndian(data, 1, 4);
    } else {
      throw new Error("Lookup table cleanup compute budget is invalid");
    }
  }
  if (!instructions.length) return;
  if (
    unitLimit === null || unitPrice === null || unitLimit < BigInt(1) ||
    unitLimit > MAX_LOOKUP_CLEANUP_COMPUTE_UNIT_LIMIT ||
    unitPrice > MAX_LOOKUP_CLEANUP_COMPUTE_UNIT_PRICE ||
    (instructions.length === 3 && loadedAccountsBytes === null) ||
    loadedAccountsBytes === BigInt(0) ||
    (loadedAccountsBytes !== null && loadedAccountsBytes > MAX_LOOKUP_CLEANUP_LOADED_ACCOUNTS_BYTES) ||
    unitLimit * unitPrice > MAX_LOOKUP_CLEANUP_PRIORITY_FEE_LAMPORTS * BigInt(1_000_000)
  ) {
    throw new Error("Lookup table cleanup priority fee is invalid");
  }
}

function assertSemanticCleanupMessage(
  message: MessageV0,
  expectation: LookupCleanupExpectation,
): void {
  const hasExpectedBlockhash = message.recentBlockhash === expectation.blockhash;
  const hasExpectedPayer = message.staticAccountKeys[0]?.equals(expectation.wallet) ?? false;
  if (
    !hasExpectedBlockhash ||
    message.addressTableLookups.length !== 0 ||
    message.header.numRequiredSignatures !== 1 ||
    !hasExpectedPayer ||
    ![1, 3, 4].includes(message.compiledInstructions.length)
  ) {
    throw new Error([
      "Lookup table cleanup instruction set is invalid",
      `instructions=${message.compiledInstructions.length}`,
      `signers=${message.header.numRequiredSignatures}`,
      `lookups=${message.addressTableLookups.length}`,
      `payer=${hasExpectedPayer}`,
      `blockhash=${hasExpectedBlockhash}`,
    ].join("; "));
  }
  const instructions = message.compiledInstructions.map((_, index) =>
    resolveInstruction(message, index));
  const computeBudgetPrefix = instructions.slice(0, -1);
  validateComputeBudgetPrefix(computeBudgetPrefix);
  const expected = new TransactionMessage({
    payerKey: expectation.wallet,
    recentBlockhash: expectation.blockhash,
    instructions: [...computeBudgetPrefix, cleanupInstruction(expectation)],
  }).compileToV0Message();
  if (!Buffer.from(message.serialize()).equals(Buffer.from(expected.serialize()))) {
    throw new Error(`Lookup table ${expectation.phase} transaction changed`);
  }
}

export function validateLookupCleanupTransaction(
  transactionBase64: string,
  expectation: LookupCleanupExpectation,
  requireWalletSignature = false,
): VersionedTransaction {
  const transaction = VersionedTransaction.deserialize(
    Buffer.from(transactionBase64, "base64"),
  );
  if (transaction.message.version !== 0) {
    throw new Error("Lookup table cleanup must use a v0 message");
  }
  assertSemanticCleanupMessage(transaction.message, expectation);
  if (transaction.signatures.length !== 1) {
    throw new Error("Lookup table cleanup has an unexpected signer set");
  }
  const isSigned = transaction.signatures[0]?.some((byte) => byte !== 0) ?? false;
  if (requireWalletSignature && !isSigned) {
    throw new Error("Lookup table cleanup is not signed by the wallet");
  }
  if (
    requireWalletSignature &&
    !nacl.sign.detached.verify(
      transaction.message.serialize(),
      transaction.signatures[0],
      expectation.wallet.toBytes(),
    )
  ) {
    throw new Error("Lookup table cleanup wallet signature is invalid");
  }
  if (!requireWalletSignature && isSigned) {
    throw new Error("Server lookup table cleanup must be unsigned");
  }
  return transaction;
}

export function validateLookupCleanupMessage(
  message: MessageV0,
  expectation: LookupCleanupExpectation,
): void {
  assertSemanticCleanupMessage(message, expectation);
}

export function assertExactLookupTableForCleanup(
  accountInfo: AccountInfo<Buffer>,
  expectation: ExactLookupTableExpectation,
): AddressLookupTableAccount {
  if (!accountInfo.owner.equals(AddressLookupTableProgram.programId) || accountInfo.executable) {
    throw new Error("Lookup table account has an invalid owner");
  }
  const lookupTable = new AddressLookupTableAccount({
    key: expectation.lookupTable,
    state: AddressLookupTableAccount.deserialize(accountInfo.data),
  });
  const { state } = lookupTable;
  if (!state.authority?.equals(expectation.wallet)) {
    throw new Error("Lookup table authority changed");
  }
  if (
    state.addresses.length !== expectation.addresses.length ||
    state.addresses.some((address, index) => !address.equals(expectation.addresses[index]))
  ) {
    throw new Error("Lookup table address vector changed");
  }
  if (!Number.isSafeInteger(state.lastExtendedSlot) || expectation.currentSlot <= state.lastExtendedSlot) {
    throw new Error("Lookup table is not activated");
  }
  return lookupTable;
}

export function parseSlotHashes(data: Buffer): readonly bigint[] {
  if (data.length < 8) throw new Error("SlotHashes account is truncated");
  const count = data.readBigUInt64LE(0);
  if (count > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("SlotHashes count is unsafe");
  const expectedLength = 8 + Number(count) * 40;
  if (data.length !== expectedLength) throw new Error("SlotHashes account length is invalid");
  const slots: bigint[] = [];
  for (let offset = 8; offset < data.length; offset += 40) {
    slots.push(data.readBigUInt64LE(offset));
  }
  return slots;
}

export function assertLookupTableCanClose(
  deactivationSlot: bigint,
  slotHashesData: Buffer,
): void {
  if (deactivationSlot === LOOKUP_TABLE_ACTIVE_SLOT) {
    throw new Error("Lookup table is still active");
  }
  const slots = parseSlotHashes(slotHashesData);
  if (slots.length === 0 || deactivationSlot > slots[0]) {
    throw new Error("Lookup table deactivation slot is invalid");
  }
  if (slots.includes(deactivationSlot)) {
    throw new Error("Lookup table cooldown is still active");
  }
}
