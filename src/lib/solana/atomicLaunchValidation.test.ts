import assert from "node:assert/strict";
import test from "node:test";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  Keypair,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import {
  buildAtomicLaunchInstructions,
  freezeAtomicLaunchConfig,
} from "./atomicLaunchBuilder.server";
import { buildLookupTablePreparation, canonicalLookupAddresses } from "./lookupTable";
import {
  assertLookupSetupCoSigner,
  validateAtomicLaunchTransactionClient,
  validateLookupSetupTransaction,
  validateReviewedUnlockTimestamp,
} from "./atomicLaunchValidation";

const keypair = (value: number) =>
  Keypair.fromSeed(Uint8Array.from({ length: 32 }, () => value));

async function fixture() {
  const wallet = keypair(1).publicKey;
  const mint = keypair(2).publicKey;
  const metadata = keypair(3).publicKey;
  const metadataUri = "https://example.com/metadata.json";
  const config = freezeAtomicLaunchConfig({
    name: "Atomic",
    ticker: "ATM",
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
    key: keypair(4).publicKey,
    state: {
      authority: wallet,
      addresses: [...lookupAddresses],
      deactivationSlot: BigInt("0xffffffffffffffff"),
      lastExtendedSlot: 10,
      lastExtendedSlotStartIndex: 0,
    },
  });
  const instructions = [
    ...plan.instructions,
    AddressLookupTableProgram.deactivateLookupTable({
      lookupTable: lookupTable.key,
      authority: wallet,
    }),
  ];
  const blockhash = keypair(5).publicKey.toBase58();
  const expectation = {
    wallet,
    mint,
    metadata,
    lookupTable,
    lookupAddresses,
    blockhash,
    name: config.name,
    ticker: config.ticker,
    metadataUri,
    quotedTokenAmount: plan.quotedTokenAmount.toString(),
    maxQuoteAmount: plan.maxQuoteAmount.toString(),
    lockAmount: plan.lockAmount.toString(),
    unlockTimestamp: plan.unlockTimestamp,
  };
  return { wallet, metadata, lookupTable, instructions, blockhash, expectation };
}

function transactionBase64(
  wallet: ReturnType<typeof keypair>["publicKey"],
  blockhash: string,
  instructions: TransactionInstruction[],
  lookupTable: AddressLookupTableAccount,
): string {
  const transaction = new VersionedTransaction(new TransactionMessage({
    payerKey: wallet,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message([lookupTable]));
  return Buffer.from(transaction.serialize()).toString("base64");
}

test("client accepts the exact resolved atomic transaction", async () => {
  const value = await fixture();
  const transaction = await validateAtomicLaunchTransactionClient(
    transactionBase64(value.wallet, value.blockhash, value.instructions, value.lookupTable),
    value.expectation,
  );
  assert.equal(transaction.message.compiledInstructions.length, 7);
});

test("client accepts and locally signs the two-signer lookup setup transaction", async () => {
  const value = await fixture();
  const metadataSigner = keypair(3);
  const preparation = buildLookupTablePreparation({
    authority: value.wallet,
    payer: value.wallet,
    coSigner: value.metadata,
    addresses: value.expectation.lookupAddresses,
    recentSlot: 100,
    blockhash: value.blockhash,
    lastValidBlockHeight: 200,
  });
  const transaction = validateLookupSetupTransaction(
    Buffer.from(preparation.transaction).toString("base64"),
    {
      wallet: value.wallet,
      coSigner: value.metadata,
      lookupTable: preparation.lookupTableAddress,
      addresses: value.expectation.lookupAddresses,
      recentSlot: 100,
      blockhash: value.blockhash,
      lastValidBlockHeight: 200,
    },
  );
  assert.equal(preparation.transaction.length, 1_224);
  assert.equal(transaction.message.header.numRequiredSignatures, 2);
  assert.equal(transaction.message.compiledInstructions.length, 5);
  assert.doesNotThrow(() => assertLookupSetupCoSigner(transaction, value.metadata));
  transaction.sign([metadataSigner]);
  assert(transaction.signatures[1].some((byte) => byte !== 0));
});

test("client accepts an already-issued one-signer setup during rollout", async () => {
  const value = await fixture();
  const preparation = buildLookupTablePreparation({
    authority: value.wallet,
    payer: value.wallet,
    addresses: value.expectation.lookupAddresses,
    recentSlot: 100,
    blockhash: value.blockhash,
    lastValidBlockHeight: 200,
  });
  const transaction = validateLookupSetupTransaction(
    Buffer.from(preparation.transaction).toString("base64"),
    {
      wallet: value.wallet,
      coSigner: value.metadata,
      lookupTable: preparation.lookupTableAddress,
      addresses: value.expectation.lookupAddresses,
      recentSlot: 100,
      blockhash: value.blockhash,
      lastValidBlockHeight: 200,
    },
  );
  assert.equal(transaction.message.header.numRequiredSignatures, 1);
  assert.equal(transaction.message.compiledInstructions.length, 4);
  assert.throws(
    () => assertLookupSetupCoSigner(transaction, value.metadata),
    /must expire and be cleaned up/,
  );
  assert.throws(
    () => transaction.sign([keypair(3)]),
    /Cannot sign with non signer key/,
  );
});

test("client rejects changed global account privileges", async () => {
  const value = await fixture();
  const streamflow = value.instructions[5];
  const mutatedStreamflow = new TransactionInstruction({
    programId: streamflow.programId,
    data: streamflow.data,
    keys: streamflow.keys.map((account) => account.pubkey.equals(value.metadata)
      ? { ...account, isWritable: false }
      : account),
  });
  const mutated = [
    ...value.instructions.slice(0, 5),
    mutatedStreamflow,
    value.instructions[6],
  ];
  await assert.rejects(
    () => validateAtomicLaunchTransactionClient(
      transactionBase64(value.wallet, value.blockhash, mutated, value.lookupTable),
      value.expectation,
    ),
    /resolved instruction changed/,
  );
});

for (const [field, mutate] of [
  ["quote", (value: Awaited<ReturnType<typeof fixture>>["expectation"]) => ({
    ...value, quotedTokenAmount: (BigInt(value.quotedTokenAmount) + BigInt(1)).toString(),
  })],
  ["spend", (value: Awaited<ReturnType<typeof fixture>>["expectation"]) => ({
    ...value, maxQuoteAmount: (BigInt(value.maxQuoteAmount) + BigInt(1)).toString(),
  })],
  ["lock", (value: Awaited<ReturnType<typeof fixture>>["expectation"]) => ({
    ...value, lockAmount: (BigInt(value.lockAmount) + BigInt(1)).toString(),
  })],
  ["unlock", (value: Awaited<ReturnType<typeof fixture>>["expectation"]) => ({
    ...value, unlockTimestamp: value.unlockTimestamp + 1,
  })],
] as const) {
  test(`client rejects a manipulated ${field} term`, async () => {
    const value = await fixture();
    await assert.rejects(() => validateAtomicLaunchTransactionClient(
      transactionBase64(value.wallet, value.blockhash, value.instructions, value.lookupTable),
      mutate(value.expectation),
    ));
  });
}

test("client rejects unlock timestamps outside the trusted cluster-time window", () => {
  assert.throws(
    () => validateReviewedUnlockTimestamp(1_900_000_000 + 30 * 86_400, 1_900_000_000, 30),
    /reviewed duration/,
  );
});
