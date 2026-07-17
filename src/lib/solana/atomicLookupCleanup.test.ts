import assert from "node:assert/strict";
import test from "node:test";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionMessage,
  TransactionInstruction,
  VersionedTransaction,
  type AccountInfo,
} from "@solana/web3.js";
import {
  LOOKUP_TABLE_ACTIVE_SLOT,
  assertExactLookupTableForCleanup,
  assertLookupTableCanClose,
  buildLegacyLookupCleanupTransaction,
  buildLookupCleanupTransaction,
  parseSlotHashes,
  validateLookupCleanupTransaction,
} from "./atomicLookupCleanup";

const BLOCKHASH = Keypair.generate().publicKey.toBase58();
const LIGHTHOUSE_PROGRAM_ID = new PublicKey("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95");

function slotHashes(slots: readonly bigint[]): Buffer {
  const data = Buffer.alloc(8 + slots.length * 40);
  data.writeBigUInt64LE(BigInt(slots.length), 0);
  slots.forEach((slot, index) => data.writeBigUInt64LE(slot, 8 + index * 40));
  return data;
}

function tableAccount(
  table: PublicKey,
  wallet: PublicKey,
  addresses: readonly PublicKey[],
  deactivationSlot = LOOKUP_TABLE_ACTIVE_SLOT,
): { tableState: AddressLookupTableAccount; info: AccountInfo<Buffer> } {
  const tableState = new AddressLookupTableAccount({
    key: table,
    state: {
      authority: wallet,
      addresses: [...addresses],
      deactivationSlot,
      lastExtendedSlot: 10,
      lastExtendedSlotStartIndex: 0,
    },
  });
  const encoded = Buffer.alloc(56 + addresses.length * 32);
  encoded.writeUInt32LE(1, 0);
  encoded.writeBigUInt64LE(deactivationSlot, 4);
  encoded.writeBigUInt64LE(BigInt(10), 12);
  encoded.writeUInt8(0, 20);
  encoded.writeUInt8(1, 21);
  wallet.toBuffer().copy(encoded, 22);
  addresses.forEach((address, index) => address.toBuffer().copy(encoded, 56 + index * 32));
  return {
    tableState,
    info: {
      data: encoded,
      executable: false,
      lamports: 1,
      owner: AddressLookupTableProgram.programId,
      rentEpoch: 0,
    },
  };
}

test("builds exact unsigned fee-pinned deactivate and owner-recipient close", () => {
  const wallet = Keypair.generate().publicKey;
  const lookupTable = Keypair.generate().publicKey;
  for (const phase of ["deactivate", "close"] as const) {
    const expectation = { phase, wallet, lookupTable, blockhash: BLOCKHASH };
    const transaction = buildLookupCleanupTransaction(expectation);
    const decoded = validateLookupCleanupTransaction(
      Buffer.from(transaction.serialize()).toString("base64"),
      expectation,
    );
    assert.equal(decoded.message.compiledInstructions.length, 3);
    assert.equal(decoded.message.addressTableLookups.length, 0);
    assert.deepEqual(decoded.message.staticAccountKeys[0], wallet);
    transaction.signatures[0][0] = 1;
    assert.throws(() => validateLookupCleanupTransaction(
      Buffer.from(transaction.serialize()).toString("base64"),
      expectation,
      true,
    ), /signature is invalid/);
  }
});

test("accepts an exact legacy cleanup issuance during rollout", () => {
  const wallet = Keypair.generate().publicKey;
  const expectation = {
    phase: "deactivate" as const,
    wallet,
    lookupTable: Keypair.generate().publicKey,
    blockhash: BLOCKHASH,
  };
  const transaction = buildLegacyLookupCleanupTransaction(expectation);
  const decoded = validateLookupCleanupTransaction(
    Buffer.from(transaction.serialize()).toString("base64"),
    expectation,
  );
  assert.equal(decoded.message.compiledInstructions.length, 1);
});

function repricedCleanup(
  wallet: Keypair,
  lookupTable: PublicKey,
  units: number,
  microLamports: bigint,
): VersionedTransaction {
  const transaction = new VersionedTransaction(new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
      ComputeBudgetProgram.setComputeUnitLimit({ units }),
      AddressLookupTableProgram.deactivateLookupTable({
        authority: wallet.publicKey,
        lookupTable,
      }),
    ],
  }).compileToV0Message());
  transaction.sign([wallet]);
  return transaction;
}

function loadedAccountsLimit(bytes: number): TransactionInstruction {
  const data = Buffer.alloc(5);
  data[0] = 4;
  data.writeUInt32LE(bytes, 1);
  return new TransactionInstruction({
    programId: ComputeBudgetProgram.programId,
    keys: [],
    data,
  });
}

function phantomCleanup(
  wallet: Keypair,
  lookupTable: PublicKey,
  loadedAccountsBytes: number,
  isDuplicateLoadedLimit = false,
): VersionedTransaction {
  const loadedLimit = loadedAccountsLimit(loadedAccountsBytes);
  const transaction = new VersionedTransaction(new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: BigInt(1_000_000) }),
      loadedLimit,
      ...(isDuplicateLoadedLimit ? [loadedLimit] : []),
      AddressLookupTableProgram.deactivateLookupTable({
        authority: wallet.publicKey,
        lookupTable,
      }),
    ],
  }).compileToV0Message());
  transaction.sign([wallet]);
  return transaction;
}

function lighthouseGuard(target: PublicKey, dataLength: number): TransactionInstruction {
  const data = Buffer.alloc(dataLength);
  data[0] = 6;
  return new TransactionInstruction({
    programId: LIGHTHOUSE_PROGRAM_ID,
    keys: [{ pubkey: target, isSigner: false, isWritable: false }],
    data,
  });
}

function lighthouseGuardedCleanup(
  wallet: Keypair,
  lookupTable: PublicKey,
): VersionedTransaction {
  const transaction = new VersionedTransaction(new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: BigInt(1_000_000) }),
      lighthouseGuard(wallet.publicKey, 37),
      AddressLookupTableProgram.deactivateLookupTable({
        authority: wallet.publicKey,
        lookupTable,
      }),
      lighthouseGuard(lookupTable, 26),
    ],
  }).compileToV0Message());
  transaction.sign([wallet]);
  return transaction;
}

test("accepts a wallet-repriced cleanup within strict compute and fee caps", () => {
  const wallet = Keypair.generate();
  const lookupTable = Keypair.generate().publicKey;
  const transaction = repricedCleanup(wallet, lookupTable, 100_000, BigInt(1_000_000));

  assert.doesNotThrow(() => validateLookupCleanupTransaction(
    Buffer.from(transaction.serialize()).toString("base64"),
    { phase: "deactivate", wallet: wallet.publicKey, lookupTable, blockhash: BLOCKHASH },
    true,
  ));
});

test("accepts Phantom loaded-account sizing within the strict cap", () => {
  const wallet = Keypair.generate();
  const lookupTable = Keypair.generate().publicKey;
  const transaction = phantomCleanup(wallet, lookupTable, 64 * 1024 * 1024);

  assert.doesNotThrow(() => validateLookupCleanupTransaction(
    Buffer.from(transaction.serialize()).toString("base64"),
    { phase: "deactivate", wallet: wallet.publicKey, lookupTable, blockhash: BLOCKHASH },
    true,
  ));
});

test("accepts exact Phantom Lighthouse guards around cleanup", () => {
  const wallet = Keypair.generate();
  const lookupTable = Keypair.generate().publicKey;
  const transaction = lighthouseGuardedCleanup(wallet, lookupTable);

  assert.doesNotThrow(() => validateLookupCleanupTransaction(
    Buffer.from(transaction.serialize()).toString("base64"),
    { phase: "deactivate", wallet: wallet.publicKey, lookupTable, blockhash: BLOCKHASH },
    true,
  ));
});

test("rejects oversized or duplicate loaded-account sizing", () => {
  const wallet = Keypair.generate();
  const lookupTable = Keypair.generate().publicKey;
  for (const transaction of [
    phantomCleanup(wallet, lookupTable, 64 * 1024 * 1024 + 1),
    phantomCleanup(wallet, lookupTable, 64 * 1024 * 1024, true),
  ]) {
    assert.throws(() => validateLookupCleanupTransaction(
      Buffer.from(transaction.serialize()).toString("base64"),
      { phase: "deactivate", wallet: wallet.publicKey, lookupTable, blockhash: BLOCKHASH },
      true,
    ), /instruction set is invalid|compute budget is invalid|priority fee is invalid|Lighthouse guard is invalid/);
  }
});

test("rejects cleanup repricing above strict compute and fee caps", () => {
  const wallet = Keypair.generate();
  const lookupTable = Keypair.generate().publicKey;
  for (const transaction of [
    repricedCleanup(wallet, lookupTable, 100_001, BigInt(1)),
    repricedCleanup(wallet, lookupTable, 100_000, BigInt(1_000_001)),
  ]) {
    assert.throws(() => validateLookupCleanupTransaction(
      Buffer.from(transaction.serialize()).toString("base64"),
      { phase: "deactivate", wallet: wallet.publicKey, lookupTable, blockhash: BLOCKHASH },
      true,
    ), /priority fee is invalid/);
  }
});

test("rejects duplicate cleanup compute-budget instructions", () => {
  const wallet = Keypair.generate();
  const lookupTable = Keypair.generate().publicKey;
  const transaction = new VersionedTransaction(new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 25_000 }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 30_000 }),
      AddressLookupTableProgram.deactivateLookupTable({
        authority: wallet.publicKey,
        lookupTable,
      }),
    ],
  }).compileToV0Message());
  transaction.sign([wallet]);

  assert.throws(() => validateLookupCleanupTransaction(
    Buffer.from(transaction.serialize()).toString("base64"),
    { phase: "deactivate", wallet: wallet.publicKey, lookupTable, blockhash: BLOCKHASH },
    true,
  ), /compute budget is invalid/);
});

test("rejects a close transaction whose recipient is not the owner wallet", () => {
  const wallet = Keypair.generate().publicKey;
  const lookupTable = Keypair.generate().publicKey;
  const attacker = Keypair.generate().publicKey;
  const transaction = buildLookupCleanupTransaction({
    phase: "close",
    wallet: attacker,
    lookupTable,
    blockhash: BLOCKHASH,
  });
  assert.throws(
    () => validateLookupCleanupTransaction(
      Buffer.from(transaction.serialize()).toString("base64"),
      { phase: "close", wallet, lookupTable, blockhash: BLOCKHASH },
    ),
    /(transaction changed|instruction set is invalid)/,
  );
});

test("validates ALT program owner, authority, activation, and exact ordered vector", () => {
  const wallet = Keypair.generate().publicKey;
  const table = Keypair.generate().publicKey;
  const addresses = [Keypair.generate().publicKey, Keypair.generate().publicKey];
  const { info } = tableAccount(table, wallet, addresses);
  const expectation = { wallet, lookupTable: table, addresses, currentSlot: 11 };
  assert.equal(assertExactLookupTableForCleanup(info, expectation).state.addresses.length, 2);
  assert.throws(
    () => assertExactLookupTableForCleanup(
      { ...info, owner: PublicKey.default },
      expectation,
    ),
    /invalid owner/,
  );
  assert.throws(
    () => assertExactLookupTableForCleanup(info, { ...expectation, wallet: Keypair.generate().publicKey }),
    /authority changed/,
  );
  assert.throws(
    () => assertExactLookupTableForCleanup(info, { ...expectation, addresses: [...addresses].reverse() }),
    /vector changed/,
  );
  assert.throws(
    () => assertExactLookupTableForCleanup(info, { ...expectation, currentSlot: 10 }),
    /not activated/,
  );
});

test("permits close only after the exact deactivation slot leaves SlotHashes", () => {
  const hashes = slotHashes([BigInt(100), BigInt(99), BigInt(98)]);
  assert.deepEqual(parseSlotHashes(hashes), [BigInt(100), BigInt(99), BigInt(98)]);
  assert.throws(() => assertLookupTableCanClose(BigInt(99), hashes), /cooldown/);
  assert.doesNotThrow(() => assertLookupTableCanClose(BigInt(97), hashes));
  assert.throws(() => assertLookupTableCanClose(BigInt(101), hashes), /invalid/);
  assert.throws(() => assertLookupTableCanClose(BigInt(97), Buffer.alloc(9)), /length/);
});
