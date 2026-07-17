import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type AccountInfo,
  type MessageV0,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import { DEFAULT_PRIORITY_FEE_MICROLAMPORTS } from "./constants";

export const LOOKUP_TABLE_ACTIVE_SLOT = BigInt("0xffffffffffffffff");
const LOOKUP_CLEANUP_COMPUTE_UNIT_LIMIT = 25_000;

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

function assertExactCleanupMessage(
  message: MessageV0,
  expectation: LookupCleanupExpectation,
): void {
  const expected = buildLookupCleanupTransaction(expectation).message;
  const legacyExpected = buildCleanupTransaction(expectation, false).message;
  if (![expected, legacyExpected].some((candidate) =>
    Buffer.from(message.serialize()).equals(Buffer.from(candidate.serialize())))) {
    throw new Error(`Lookup table ${expectation.phase} transaction changed`);
  }
  if (
    message.addressTableLookups.length !== 0 ||
    ![1, 3].includes(message.compiledInstructions.length)
  ) {
    throw new Error("Lookup table cleanup instruction set is invalid");
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
  assertExactCleanupMessage(transaction.message, expectation);
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
  assertExactCleanupMessage(message, expectation);
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
