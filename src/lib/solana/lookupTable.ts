import { createHash } from "node:crypto";
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
  DEFAULT_PRIORITY_FEE_MICROLAMPORTS,
  LOOKUP_SETUP_COMPUTE_UNIT_LIMIT,
  MEMO_PROGRAM_ID,
} from "./constants";

const MAX_LOOKUP_ADDRESSES = 256;
const U64_MAX = BigInt("0xffffffffffffffff");

export interface LookupTablePreparation {
  lookupTableAddress: PublicKey;
  addressHash: string;
  addresses: readonly PublicKey[];
  transaction: Uint8Array;
  recentSlot: number;
  blockhash: string;
  lastValidBlockHeight: number;
}

export interface LookupTablePreparationParams {
  authority: PublicKey;
  payer: PublicKey;
  coSigner?: PublicKey;
  addresses: readonly PublicKey[];
  recentSlot: number;
  blockhash: string;
  lastValidBlockHeight: number;
}

function assertPublicKeyVector(addresses: readonly PublicKey[]): void {
  if (addresses.length < 1 || addresses.length > MAX_LOOKUP_ADDRESSES) {
    throw new Error("Lookup table address count is invalid");
  }
  const encoded = addresses.map((address) => address.toBase58());
  if (new Set(encoded).size !== encoded.length) {
    throw new Error("Lookup table addresses must be unique");
  }
}

export function canonicalLookupAddresses(
  instructions: readonly TransactionInstruction[],
  staticSigners: readonly PublicKey[],
): readonly PublicKey[] {
  const signerSet = new Set(staticSigners.map((key) => key.toBase58()));
  const programSet = new Set(instructions.map((ix) => ix.programId.toBase58()));
  const seen = new Set<string>();
  const addresses: PublicKey[] = [];

  for (const instruction of instructions) {
    for (const account of instruction.keys) {
      const encoded = account.pubkey.toBase58();
      if (account.isSigner || signerSet.has(encoded) || programSet.has(encoded) || seen.has(encoded)) {
        continue;
      }
      seen.add(encoded);
      addresses.push(account.pubkey);
    }
  }
  assertPublicKeyVector(addresses);
  return Object.freeze(addresses);
}

export function hashLookupAddresses(addresses: readonly PublicKey[]): string {
  assertPublicKeyVector(addresses);
  const hash = createHash("sha256");
  hash.update(Buffer.from("lckd-atomic-alt-v1", "utf8"));
  for (const address of addresses) hash.update(address.toBuffer());
  return hash.digest("hex");
}

function buildPreparationMessages(
  params: LookupTablePreparationParams,
): { lookupTableAddress: PublicKey; message: ReturnType<TransactionMessage["compileToV0Message"]> } {
  if (!params.authority.equals(params.payer)) {
    throw new Error("Lookup table authority and payer must be the launch wallet");
  }
  if (params.coSigner?.equals(params.payer)) {
    throw new Error("Lookup table co-signer must be distinct from the launch wallet");
  }
  if (!Number.isSafeInteger(params.recentSlot) || params.recentSlot < 1) {
    throw new Error("Lookup table recent slot is invalid");
  }
  if (!Number.isSafeInteger(params.lastValidBlockHeight) || params.lastValidBlockHeight < 1) {
    throw new Error("Lookup table block height is invalid");
  }
  assertPublicKeyVector(params.addresses);

  const [createInstruction, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
    authority: params.authority,
    payer: params.payer,
    recentSlot: params.recentSlot,
  });
  const extendInstruction = AddressLookupTableProgram.extendLookupTable({
    authority: params.authority,
    payer: params.payer,
    lookupTable: lookupTableAddress,
    addresses: [...params.addresses],
  });
  const message = new TransactionMessage({
    payerKey: params.payer,
    recentBlockhash: params.blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: LOOKUP_SETUP_COMPUTE_UNIT_LIMIT }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: DEFAULT_PRIORITY_FEE_MICROLAMPORTS,
      }),
      ...(params.coSigner ? [new TransactionInstruction({
        programId: MEMO_PROGRAM_ID,
        keys: [{ pubkey: params.coSigner, isSigner: true, isWritable: false }],
        data: Buffer.alloc(0),
      })] : []),
      createInstruction,
      extendInstruction,
    ],
  }).compileToV0Message();
  return { lookupTableAddress, message };
}

function buildLegacyPreparationMessage(
  params: LookupTablePreparationParams,
): ReturnType<TransactionMessage["compileToV0Message"]> {
  const [createInstruction] = AddressLookupTableProgram.createLookupTable({
    authority: params.authority,
    payer: params.payer,
    recentSlot: params.recentSlot,
  });
  const extendInstruction = AddressLookupTableProgram.extendLookupTable({
    authority: params.authority,
    payer: params.payer,
    lookupTable: AddressLookupTableProgram.createLookupTable({
      authority: params.authority,
      payer: params.payer,
      recentSlot: params.recentSlot,
    })[1],
    addresses: [...params.addresses],
  });
  return new TransactionMessage({
    payerKey: params.payer,
    recentBlockhash: params.blockhash,
    instructions: [createInstruction, extendInstruction],
  }).compileToV0Message();
}

export function buildLookupTablePreparation(
  params: LookupTablePreparationParams,
): LookupTablePreparation {
  const { lookupTableAddress, message } = buildPreparationMessages(params);
  const transaction = new VersionedTransaction(message).serialize();
  if (transaction.length > 1_232) {
    throw new Error("Lookup table preparation transaction is too large");
  }
  return Object.freeze({
    lookupTableAddress,
    addressHash: hashLookupAddresses(params.addresses),
    addresses: Object.freeze([...params.addresses]),
    transaction,
    recentSlot: params.recentSlot,
    blockhash: params.blockhash,
    lastValidBlockHeight: params.lastValidBlockHeight,
  });
}

export function validateLookupTablePreparation(
  transactionBytes: Uint8Array,
  params: LookupTablePreparationParams,
): PublicKey {
  const { lookupTableAddress, message: expected } = buildPreparationMessages(params);
  const pinnedOneSignerExpected = buildPreparationMessages({
    ...params,
    coSigner: undefined,
  }).message;
  const legacyExpected = buildLegacyPreparationMessage(params);
  if (transactionBytes.length > 1_232) {
    throw new Error("Lookup table preparation transaction is too large");
  }
  try {
    const transaction = VersionedTransaction.deserialize(transactionBytes);
    const message = transaction.message;
    if (
      message.addressTableLookups.length !== 0 ||
      ![1, 2].includes(message.header.numRequiredSignatures) ||
      !message.staticAccountKeys[0]?.equals(params.authority) ||
      ![expected, pinnedOneSignerExpected, legacyExpected].some((candidate) =>
        Buffer.from(message.serialize()).equals(Buffer.from(candidate.serialize())))
    ) {
      throw new Error("mismatch");
    }
  } catch {
    throw new Error("Lookup table preparation transaction mismatch");
  }
  return lookupTableAddress;
}

function assertExactLookupTable(
  lookupTable: AddressLookupTableAccount,
  expectedAddress: PublicKey,
  authority: PublicKey,
  addresses: readonly PublicKey[],
  currentSlot: number,
): void {
  const state = lookupTable.state;
  if (!lookupTable.key.equals(expectedAddress)) throw new Error("Lookup table address mismatch");
  if (!state.authority?.equals(authority)) throw new Error("Lookup table authority mismatch");
  if (state.deactivationSlot !== U64_MAX) throw new Error("Lookup table is deactivated");
  if (currentSlot <= state.lastExtendedSlot) throw new Error("Lookup table is not activated yet");
  if (
    state.addresses.length !== addresses.length ||
    state.addresses.some((address, index) => !address.equals(addresses[index]))
  ) {
    throw new Error("Lookup table address vector mismatch");
  }
}

export function validateExactLookupTable(
  lookupTable: AddressLookupTableAccount,
  expectedAddress: PublicKey,
  authority: PublicKey,
  addresses: readonly PublicKey[],
  currentSlot: number,
): AddressLookupTableAccount {
  if (!Number.isSafeInteger(currentSlot) || currentSlot < 1) {
    throw new Error("Lookup table current slot is invalid");
  }
  assertPublicKeyVector(addresses);
  assertExactLookupTable(lookupTable, expectedAddress, authority, addresses, currentSlot);
  return lookupTable;
}

export async function resolveExactLookupTable(
  connection: Connection,
  expectedAddress: PublicKey,
  authority: PublicKey,
  addresses: readonly PublicKey[],
): Promise<AddressLookupTableAccount> {
  const response = await connection.getAccountInfoAndContext(expectedAddress, "confirmed");
  if (!response.value) throw new Error("Lookup table account does not exist");
  if (!response.value.owner.equals(AddressLookupTableProgram.programId)) {
    throw new Error("Lookup table account owner mismatch");
  }
  const state = AddressLookupTableAccount.deserialize(response.value.data);
  const currentSlot = await connection.getSlot({
    commitment: "confirmed",
    minContextSlot: response.context.slot,
  });
  return validateExactLookupTable(
    new AddressLookupTableAccount({ key: expectedAddress, state }),
    expectedAddress,
    authority,
    addresses,
    currentSlot,
  );
}

export function validateProtocolLookupTable(
  lookupTable: AddressLookupTableAccount,
  expectedAddress: PublicKey,
  addresses: readonly PublicKey[],
  currentSlot: number,
): AddressLookupTableAccount {
  if (!Number.isSafeInteger(currentSlot) || currentSlot < 1) {
    throw new Error("Protocol lookup table current slot is invalid");
  }
  assertPublicKeyVector(addresses);
  if (!lookupTable.key.equals(expectedAddress)) throw new Error("Protocol lookup table address mismatch");
  if (lookupTable.state.deactivationSlot !== U64_MAX) {
    throw new Error("Protocol lookup table is deactivated");
  }
  if (currentSlot <= lookupTable.state.lastExtendedSlot) {
    throw new Error("Protocol lookup table is not activated yet");
  }
  if (
    lookupTable.state.addresses.length !== addresses.length ||
    lookupTable.state.addresses.some((address, index) => !address.equals(addresses[index]))
  ) {
    throw new Error("Protocol lookup table address vector mismatch");
  }
  return lookupTable;
}

export async function resolveProtocolLookupTable(
  connection: Connection,
  expectedAddress: PublicKey,
  addresses: readonly PublicKey[],
): Promise<AddressLookupTableAccount> {
  const response = await connection.getAccountInfoAndContext(expectedAddress, "confirmed");
  if (!response.value) throw new Error("Protocol lookup table account does not exist");
  if (!response.value.owner.equals(AddressLookupTableProgram.programId)) {
    throw new Error("Protocol lookup table account owner mismatch");
  }
  const lookupTable = new AddressLookupTableAccount({
    key: expectedAddress,
    state: AddressLookupTableAccount.deserialize(response.value.data),
  });
  const currentSlot = await connection.getSlot({
    commitment: "confirmed",
    minContextSlot: response.context.slot,
  });
  return validateProtocolLookupTable(lookupTable, expectedAddress, addresses, currentSlot);
}
