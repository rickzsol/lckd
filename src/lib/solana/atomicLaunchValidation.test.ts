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
  buybackProtocolLookupAddresses,
  freezeAtomicLaunchConfig,
} from "./atomicLaunchBuilder.server";
import { buildLookupTablePreparation, canonicalLookupAddresses } from "./lookupTable";
import { BUYBACK_BURN_PROGRAM_ID, deriveBuybackBurnAuthority } from "./buybackBurn";
import {
  assertLookupSetupCoSigner,
  validateAtomicLaunchTransactionClient,
  validateLookupSetupTransaction,
  validateReviewedUnlockTimestamp,
} from "./atomicLaunchValidation";

const keypair = (value: number) =>
  Keypair.fromSeed(Uint8Array.from({ length: 32 }, () => value));

async function fixture(hasLock = true) {
  const wallet = keypair(1).publicKey;
  const mint = keypair(2).publicKey;
  const metadata = keypair(3).publicKey;
  const metadataUri = "https://example.com/metadata.json";
  const config = freezeAtomicLaunchConfig({
    name: "Atomic",
    ticker: "ATM",
    buyAmountSol: 0.1,
    hasLock,
    lockDurationDays: 30,
    lockPercentage: 99,
  });
  const plan = await buildAtomicLaunchInstructions(
    { config, walletPublicKey: wallet, mintPublicKey: mint, metadataPublicKey: metadata, metadataUri },
    {
      quotedTokenAmount: new BN("250000000000000"),
      maxQuoteAmount: new BN("110000000"),
      streamflowFeePercent: hasLock ? 0.19 : 0,
      unlockTimestamp: hasLock ? 1_900_000_000 : 0,
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
    hasLock,
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
    fee: {
      feeMode: "waived" as const,
      feeLamports: null,
      feeLckdRaw: null,
      feeTreasury: null,
    },
  };
  return { wallet, metadata, lookupTable, instructions, blockhash, expectation };
}

function transactionBase64(
  wallet: ReturnType<typeof keypair>["publicKey"],
  blockhash: string,
  instructions: TransactionInstruction[],
  lookupTable: AddressLookupTableAccount | AddressLookupTableAccount[],
): string {
  const transaction = new VersionedTransaction(new TransactionMessage({
    payerKey: wallet,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(Array.isArray(lookupTable) ? lookupTable : [lookupTable]));
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

test("client accepts the exact signed no-lock marker", async () => {
  const value = await fixture(false);
  const transaction = await validateAtomicLaunchTransactionClient(
    transactionBase64(value.wallet, value.blockhash, value.instructions, value.lookupTable),
    value.expectation,
  );
  assert.equal(value.expectation.lockAmount, "0");
  assert.equal(value.expectation.unlockTimestamp, 0);
  assert.equal(transaction.message.compiledInstructions.length, 7);
});

test("client reconstructs and accepts the exact buyback instruction and two lookup tables", async () => {
  const wallet = keypair(1).publicKey;
  const mint = keypair(2).publicKey;
  const metadata = keypair(3).publicKey;
  const metadataUri = "https://example.com/metadata.json";
  const authority = deriveBuybackBurnAuthority(BUYBACK_BURN_PROGRAM_ID);
  const fee = {
    feeMode: "buybackBurn" as const,
    feeLamports: 100_000_000,
    feeLckdRaw: "123456789",
    feeTreasury: authority.toBase58(),
  };
  const config = freezeAtomicLaunchConfig({
    name: "Atomic", ticker: "ATM", buyAmountSol: 0.1, lockDurationDays: 30,
    lockPercentage: 99, ...fee,
  });
  const plan = await buildAtomicLaunchInstructions(
    { config, walletPublicKey: wallet, mintPublicKey: mint, metadataPublicKey: metadata, metadataUri },
    {
      quotedTokenAmount: new BN("250000000000000"), maxQuoteAmount: new BN("110000000"),
      streamflowFeePercent: 0.19, unlockTimestamp: 1_900_000_000,
    },
  );
  const protocolLookupAddresses = buybackProtocolLookupAddresses(plan, wallet);
  const protocolSet = new Set(protocolLookupAddresses.map((address) => address.toBase58()));
  const lookupAddresses = canonicalLookupAddresses(plan.instructions, [wallet, mint, metadata])
    .filter((address) => !protocolSet.has(address.toBase58()));
  const lookupTable = testLookupTable(keypair(4).publicKey, wallet, lookupAddresses);
  const protocolLookupTable = testLookupTable(
    keypair(6).publicKey,
    keypair(7).publicKey,
    protocolLookupAddresses,
  );
  const blockhash = keypair(5).publicKey.toBase58();
  const expectation = {
    wallet, mint, metadata, lookupTable, lookupAddresses, protocolLookupTable,
    protocolLookupAddresses, blockhash, name: config.name, ticker: config.ticker,
    metadataUri, quotedTokenAmount: plan.quotedTokenAmount.toString(),
    maxQuoteAmount: plan.maxQuoteAmount.toString(), lockAmount: plan.lockAmount.toString(),
    unlockTimestamp: plan.unlockTimestamp, fee,
  };
  const encoded = transactionBase64(
    wallet,
    blockhash,
    [...plan.instructions],
    [lookupTable, protocolLookupTable],
  );
  const readDescriptor = Object.getOwnPropertyDescriptor(Buffer.prototype, "readBigUInt64LE");
  const writeDescriptor = Object.getOwnPropertyDescriptor(Buffer.prototype, "writeBigUInt64LE");
  assert(readDescriptor);
  assert(writeDescriptor);
  Object.defineProperty(Buffer.prototype, "readBigUInt64LE", { value: undefined });
  Object.defineProperty(Buffer.prototype, "writeBigUInt64LE", { value: undefined });
  let transaction: VersionedTransaction;
  try {
    transaction = await validateAtomicLaunchTransactionClient(encoded, expectation);
  } finally {
    Object.defineProperty(Buffer.prototype, "readBigUInt64LE", readDescriptor);
    Object.defineProperty(Buffer.prototype, "writeBigUInt64LE", writeDescriptor);
  }
  assert.equal(transaction.message.header.numRequiredSignatures, 3);
  assert.equal(transaction.message.addressTableLookups.length, 2);
  assert(Buffer.from(encoded, "base64").length <= 1_232);

  await assert.rejects(
    () => validateAtomicLaunchTransactionClient(encoded, {
      ...expectation,
      fee: { ...fee, feeLckdRaw: "123456788" },
    }),
    /buyback|instruction|changed/i,
  );
  await assert.rejects(
    () => validateAtomicLaunchTransactionClient(encoded, {
      ...expectation,
      protocolLookupAddresses: [...protocolLookupAddresses].reverse(),
    }),
    /protocol lookup/i,
  );
});

function testLookupTable(
  tableKey: ReturnType<typeof keypair>["publicKey"],
  authority: ReturnType<typeof keypair>["publicKey"],
  addresses: readonly ReturnType<typeof keypair>["publicKey"][],
) {
  return new AddressLookupTableAccount({
    key: tableKey,
    state: {
      authority,
      addresses: [...addresses],
      deactivationSlot: BigInt("0xffffffffffffffff"),
      lastExtendedSlot: 10,
      lastExtendedSlotStartIndex: 0,
    },
  });
}

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

async function burnFeeFixture() {
  const wallet = keypair(1).publicKey;
  const mint = keypair(2).publicKey;
  const metadata = keypair(3).publicKey;
  const metadataUri = "https://example.com/metadata.json";
  const fee = {
    feeMode: "burnLckd" as const,
    feeLamports: null,
    feeLckdRaw: "123456789",
    feeTreasury: null,
  };
  const config = freezeAtomicLaunchConfig({
    name: "Atomic",
    ticker: "ATM",
    buyAmountSol: 0.1,
    lockDurationDays: 30,
    lockPercentage: 99,
    ...fee,
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
    fee,
  };
  return { wallet, blockhash, instructions, lookupTable, expectation };
}

test("client accepts the atomic transaction with an LCKD burn fee", async () => {
  const value = await burnFeeFixture();
  const transaction = await validateAtomicLaunchTransactionClient(
    transactionBase64(value.wallet, value.blockhash, value.instructions, value.lookupTable),
    value.expectation,
  );
  assert.equal(transaction.message.compiledInstructions.length, 8);
});

test("client rejects a burn fee amount that differs from the reviewed terms", async () => {
  const value = await burnFeeFixture();
  await assert.rejects(
    () => validateAtomicLaunchTransactionClient(
      transactionBase64(value.wallet, value.blockhash, value.instructions, value.lookupTable),
      {
        ...value.expectation,
        fee: { ...value.expectation.fee, feeLckdRaw: "987654321" },
      },
    ),
    /instruction|sequence|changed/i,
  );
});

test("client rejects a fee instruction when the reviewed launch is waived", async () => {
  const value = await burnFeeFixture();
  await assert.rejects(
    () => validateAtomicLaunchTransactionClient(
      transactionBase64(value.wallet, value.blockhash, value.instructions, value.lookupTable),
      {
        ...value.expectation,
        fee: { feeMode: "waived" as const, feeLamports: null, feeLckdRaw: null, feeTreasury: null },
      },
    ),
    /instruction|sequence|changed/i,
  );
});
