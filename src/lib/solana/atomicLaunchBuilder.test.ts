import assert from "node:assert/strict";
import test from "node:test";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import {
  buildAtomicLaunchInstructions,
  buildAtomicLaunchInstructionsFromSnapshot,
  calculateAtomicUnlockTimestamp,
  freezeAtomicLaunchConfig,
  hashAtomicTransactionMessage,
  LOCK_SUBMISSION_BUFFER_SECONDS,
  rebuildIssuedAtomicLookupPreparation,
  validateAtomicLaunchTransaction,
} from "./atomicLaunchBuilder.server";
import { buildLookupTablePreparation, canonicalLookupAddresses } from "./lookupTable";

const seededKeypair = (value: number) =>
  Keypair.fromSeed(Uint8Array.from({ length: 32 }, () => value));

async function buildFixture() {
  const wallet = seededKeypair(1).publicKey;
  const mint = seededKeypair(2).publicKey;
  const metadata = seededKeypair(3).publicKey;
  const metadataPrefix = "https://example.com/";
  const metadataUri = metadataPrefix + "m".repeat(200 - metadataPrefix.length);
  const config = freezeAtomicLaunchConfig({
    name: "N".repeat(32),
    ticker: "T".repeat(13),
    buyAmountSol: 0.1,
    lockDurationDays: 30,
    lockPercentage: 99,
  });
  const plan = await buildAtomicLaunchInstructions(
    { config, walletPublicKey: wallet, mintPublicKey: mint, metadataPublicKey: metadata, metadataUri },
    {
      quotedTokenAmount: new BN("250000000000000"),
      maxQuoteAmount: new BN("110000000"),
      streamflowFeePercent: 0.19,
      unlockTimestamp: 1_900_000_000,
    },
  );
  const lookupAddresses = canonicalLookupAddresses(plan.instructions, [wallet, mint, metadata]);
  const lookupTable = new AddressLookupTableAccount({
    key: seededKeypair(4).publicKey,
    state: {
      authority: wallet,
      addresses: [...lookupAddresses],
      deactivationSlot: BigInt("0xffffffffffffffff"),
      lastExtendedSlot: 10,
      lastExtendedSlotStartIndex: 0,
    },
  });
  const deactivate = AddressLookupTableProgram.deactivateLookupTable({
    lookupTable: lookupTable.key,
    authority: wallet,
  });
  const instructions = [...plan.instructions, deactivate];
  const blockhash = seededKeypair(5).publicKey.toBase58();
  const transaction = new VersionedTransaction(new TransactionMessage({
    payerKey: wallet,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message([lookupTable]));
  return {
    config,
    wallet,
    mint,
    metadata,
    metadataUri,
    plan,
    lookupAddresses,
    lookupTable,
    instructions,
    blockhash,
    transaction,
  };
}

test("builds a packet-sized atomic launch with three static signers and one exact ALT", async () => {
  const fixture = await buildFixture();
  const bytes = fixture.transaction.serialize();
  const validated = validateAtomicLaunchTransaction(bytes, {
    config: fixture.config,
    walletPublicKey: fixture.wallet,
    mintPublicKey: fixture.mint,
    metadataPublicKey: fixture.metadata,
    metadataUri: fixture.metadataUri,
    lookupTable: fixture.lookupTable,
    lookupAddresses: fixture.lookupAddresses,
    instructions: fixture.instructions,
    quotedTokenAmount: fixture.plan.quotedTokenAmount,
    maxQuoteAmount: fixture.plan.maxQuoteAmount,
    lockAmount: fixture.plan.lockAmount,
    unlockTimestamp: fixture.plan.unlockTimestamp,
    blockhash: fixture.blockhash,
  });

  assert(bytes.length <= 1_232, `atomic launch is ${bytes.length} bytes`);
  assert.equal(validated.message.addressTableLookups.length, 1);
  assert.deepEqual(
    validated.message.staticAccountKeys.slice(0, 3).map(String),
    [fixture.wallet, fixture.mint, fixture.metadata].map(String),
  );
  assert.equal(validated.message.compiledInstructions.length, 7);
  const setup = buildLookupTablePreparation({
    authority: fixture.wallet,
    payer: fixture.wallet,
    coSigner: fixture.metadata,
    addresses: fixture.lookupAddresses,
    recentSlot: 100,
    blockhash: fixture.blockhash,
    lastValidBlockHeight: 200,
  });
  assert.equal(fixture.lookupAddresses.length, 24);
  assert.equal(setup.transaction.length, 1_224);
});

test("rejects instruction mutation even when accounts and ALT remain valid", async () => {
  const fixture = await buildFixture();
  const mutatedInstructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 399_999 }),
    ...fixture.instructions.slice(1),
  ];
  const mutated = new VersionedTransaction(new TransactionMessage({
    payerKey: fixture.wallet,
    recentBlockhash: fixture.blockhash,
    instructions: mutatedInstructions,
  }).compileToV0Message([fixture.lookupTable]));

  assert.throws(
    () => validateAtomicLaunchTransaction(mutated.serialize(), {
      config: fixture.config,
      walletPublicKey: fixture.wallet,
      mintPublicKey: fixture.mint,
      metadataPublicKey: fixture.metadata,
      metadataUri: fixture.metadataUri,
      lookupTable: fixture.lookupTable,
      lookupAddresses: fixture.lookupAddresses,
      instructions: fixture.instructions,
      quotedTokenAmount: fixture.plan.quotedTokenAmount,
      maxQuoteAmount: fixture.plan.maxQuoteAmount,
      lockAmount: fixture.plan.lockAmount,
      unlockTimestamp: fixture.plan.unlockTimestamp,
      blockhash: fixture.blockhash,
    }),
    /instruction sequence mismatch/,
  );
});

test("requires an immutable validated launch config", async () => {
  await assert.rejects(
    () => buildAtomicLaunchInstructions(
      {
        config: {
          name: "Mutable",
          ticker: "MUT",
          buyAmountSol: 0.1,
          lockDurationDays: 30,
          lockPercentage: 100,
          feeMode: "waived" as const,
          feeLamports: null,
          feeLckdRaw: null,
          feeTreasury: null,
        },
        walletPublicKey: seededKeypair(1).publicKey,
        mintPublicKey: seededKeypair(2).publicKey,
        metadataPublicKey: seededKeypair(3).publicKey,
        metadataUri: "https://example.com/metadata.json",
      },
      {
        quotedTokenAmount: new BN(1),
        maxQuoteAmount: new BN(1),
        streamflowFeePercent: 0.19,
        unlockTimestamp: 1_900_000_000,
      },
    ),
    /exact frozen snapshot/,
  );
});

test("buffers the unlock time so finalized duration does not floor one day short", () => {
  const clusterTimestamp = 1_900_000_000;
  const requestedDays = 30;
  const unlockTimestamp = calculateAtomicUnlockTimestamp(clusterTimestamp, requestedDays);
  const finalizedBlockTime = clusterTimestamp + LOCK_SUBMISSION_BUFFER_SECONDS - 1;

  assert.equal(
    Math.floor((unlockTimestamp - finalizedBlockTime) / 86_400),
    requestedDays,
  );
});

test("rebuilds the exact persisted setup transaction on an API replay", async () => {
  const fixture = await buildFixture();
  const originalBlockhash = seededKeypair(6).publicKey.toBase58();
  const freshBlockhash = seededKeypair(7).publicKey.toBase58();
  const original = buildLookupTablePreparation({
    authority: fixture.wallet,
    payer: fixture.wallet,
    coSigner: fixture.metadata,
    addresses: fixture.lookupAddresses,
    recentSlot: 100,
    blockhash: originalBlockhash,
    lastValidBlockHeight: 200,
  });
  const freshPreparation = buildLookupTablePreparation({
    authority: fixture.wallet,
    payer: fixture.wallet,
    coSigner: fixture.metadata,
    addresses: fixture.lookupAddresses,
    recentSlot: 101,
    blockhash: freshBlockhash,
    lastValidBlockHeight: 201,
  });
  assert.notEqual(freshPreparation.lookupTableAddress.toBase58(), original.lookupTableAddress.toBase58());
  const replay = await rebuildIssuedAtomicLookupPreparation({
    config: fixture.config,
    walletPublicKey: fixture.wallet,
    mintPublicKey: fixture.mint,
    metadataPublicKey: fixture.metadata,
    metadataUri: fixture.metadataUri,
  }, {
    transaction: original.transaction,
    lookupTableAddress: original.lookupTableAddress,
    addresses: fixture.lookupAddresses,
    recentSlot: 100,
    messageHash: hashAtomicTransactionMessage(original.transaction),
    blockhash: originalBlockhash,
    lastValidBlockHeight: 200,
    plan: {
      quotedTokenAmount: fixture.plan.quotedTokenAmount.toString(),
      maxQuoteAmount: fixture.plan.maxQuoteAmount.toString(),
      lockAmount: fixture.plan.lockAmount.toString(),
      unlockTimestamp: fixture.plan.unlockTimestamp,
      streamflowFeePercent: fixture.plan.streamflowFeePercent,
    },
  });

  assert.deepEqual(replay.transaction, original.transaction);
  assert.equal(replay.recentSlot, 100);
  assert.equal(replay.blockhash, originalBlockhash);
  assert.equal(replay.lastValidBlockHeight, 200);
  assert.equal(replay.lookupTableAddress.toBase58(), original.lookupTableAddress.toBase58());
});

test("rebuilds atomic instructions only from the frozen plan snapshot", async () => {
  const fixture = await buildFixture();
  const snapshot = {
    quotedTokenAmount: fixture.plan.quotedTokenAmount.toString(),
    maxQuoteAmount: fixture.plan.maxQuoteAmount.toString(),
    lockAmount: fixture.plan.lockAmount.toString(),
    unlockTimestamp: fixture.plan.unlockTimestamp,
    streamflowFeePercent: fixture.plan.streamflowFeePercent,
  };
  const plan = await buildAtomicLaunchInstructionsFromSnapshot({
    config: fixture.config,
    walletPublicKey: fixture.wallet,
    mintPublicKey: fixture.mint,
    metadataPublicKey: fixture.metadata,
    metadataUri: fixture.metadataUri,
  }, snapshot);

  assert.equal(plan.quotedTokenAmount.toString(), snapshot.quotedTokenAmount);
  assert.equal(plan.maxQuoteAmount.toString(), snapshot.maxQuoteAmount);
  assert.equal(plan.lockAmount.toString(), snapshot.lockAmount);
  assert.equal(plan.unlockTimestamp, snapshot.unlockTimestamp);
  assert.equal(plan.streamflowFeePercent, snapshot.streamflowFeePercent);

  await assert.rejects(() => buildAtomicLaunchInstructionsFromSnapshot({
    config: fixture.config,
    walletPublicKey: fixture.wallet,
    mintPublicKey: fixture.mint,
    metadataPublicKey: fixture.metadata,
    metadataUri: fixture.metadataUri,
  }, {
    ...snapshot,
    lockAmount: new BN(snapshot.lockAmount).addn(1).toString(),
  }), /lock amount changed/);
});
