import assert from "node:assert/strict";
import test from "node:test";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Keypair,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  buildLookupTablePreparation,
  canonicalLookupAddresses,
  hashLookupAddresses,
  validateExactLookupTable,
  validateLookupTablePreparation,
} from "./lookupTable";

const wallet = Keypair.fromSeed(Uint8Array.from({ length: 32 }, () => 1)).publicKey;
const accountA = Keypair.fromSeed(Uint8Array.from({ length: 32 }, () => 2)).publicKey;
const accountB = Keypair.fromSeed(Uint8Array.from({ length: 32 }, () => 3)).publicKey;
const blockhash = Keypair.fromSeed(Uint8Array.from({ length: 32 }, () => 4)).publicKey.toBase58();

test("derives a stable unique lookup vector and hash", () => {
  const instructions = [
    new TransactionInstruction({
      programId: SystemProgram.programId,
      keys: [
        { pubkey: wallet, isSigner: true, isWritable: true },
        { pubkey: accountA, isSigner: false, isWritable: true },
        { pubkey: accountB, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1]),
    }),
    new TransactionInstruction({
      programId: accountB,
      keys: [{ pubkey: accountA, isSigner: false, isWritable: true }],
      data: Buffer.from([2]),
    }),
  ];
  const addresses = canonicalLookupAddresses(instructions, [wallet]);

  assert.deepEqual(addresses.map(String), [accountA.toBase58()]);
  assert.equal(hashLookupAddresses(addresses), hashLookupAddresses([...addresses]));
});

test("builds and strictly validates wallet-authorized create and extend transactions", () => {
  const params = {
    authority: wallet,
    payer: wallet,
    addresses: Array.from({ length: 28 }, (_, index) =>
      Keypair.fromSeed(Uint8Array.from({ length: 32 }, () => index + 10)).publicKey),
    recentSlot: 100,
    blockhash,
    lastValidBlockHeight: 200,
  };
  const preparation = buildLookupTablePreparation(params);

  assert(preparation.transaction.length <= 1_232);
  const message = VersionedTransaction.deserialize(preparation.transaction).message;
  assert.equal(message.compiledInstructions.length, 4);
  assert(message.staticAccountKeys[message.compiledInstructions[0].programIdIndex]
    .equals(ComputeBudgetProgram.programId));
  assert(message.staticAccountKeys[message.compiledInstructions[1].programIdIndex]
    .equals(ComputeBudgetProgram.programId));
  assert(validateLookupTablePreparation(preparation.transaction, params).equals(
    preparation.lookupTableAddress,
  ));
  const [legacyCreate, legacyAddress] = AddressLookupTableProgram.createLookupTable({
    authority: wallet,
    payer: wallet,
    recentSlot: params.recentSlot,
  });
  const legacyExtend = AddressLookupTableProgram.extendLookupTable({
    authority: wallet,
    payer: wallet,
    lookupTable: legacyAddress,
    addresses: params.addresses,
  });
  const legacyTransaction = new VersionedTransaction(new TransactionMessage({
    payerKey: wallet,
    recentBlockhash: blockhash,
    instructions: [legacyCreate, legacyExtend],
  }).compileToV0Message());
  assert(validateLookupTablePreparation(legacyTransaction.serialize(), params).equals(
    preparation.lookupTableAddress,
  ));

  const mutated = Uint8Array.from(preparation.transaction);
  mutated[mutated.length - 1] ^= 1;
  assert.throws(
    () => validateLookupTablePreparation(mutated, params),
    /preparation transaction mismatch/,
  );
  assert.throws(
    () => buildLookupTablePreparation({ ...params, payer: accountA }),
    /authority and payer/,
  );
});

test("rejects a wrong authority, inactive slot, deactivation, and reordered addresses", () => {
  const addresses = [accountA, accountB];
  const table = new AddressLookupTableAccount({
    key: Keypair.generate().publicKey,
    state: {
      authority: wallet,
      addresses,
      deactivationSlot: BigInt("0xffffffffffffffff"),
      lastExtendedSlot: 50,
      lastExtendedSlotStartIndex: 0,
    },
  });
  assert.equal(validateExactLookupTable(table, table.key, wallet, addresses, 51), table);
  assert.throws(
    () => validateExactLookupTable(table, table.key, accountA, addresses, 51),
    /authority mismatch/,
  );
  assert.throws(
    () => validateExactLookupTable(table, table.key, wallet, addresses, 50),
    /not activated/,
  );
  assert.throws(
    () => validateExactLookupTable(table, table.key, wallet, [...addresses].reverse(), 51),
    /vector mismatch/,
  );
  table.state.deactivationSlot = BigInt(99);
  assert.throws(
    () => validateExactLookupTable(table, table.key, wallet, addresses, 51),
    /deactivated/,
  );
});
