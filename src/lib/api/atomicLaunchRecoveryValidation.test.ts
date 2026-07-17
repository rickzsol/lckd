import assert from "node:assert/strict";
import { test } from "node:test";
import {
  atomicRpcResultSchema,
  atomicIntentSnapshotSchema,
  canTransitionAtomicStatus,
  classifyExactIssuedReceipt,
  hashCanonicalJson,
  hashOrderedAddresses,
  hasFinalizedIssuedTupleExpired,
  isExactTransactionReplay,
  issueAltCleanupSchema,
  transactionCheckpointSchema,
  replacementState,
} from "./atomicLaunchRecoveryValidation";

const WALLET = "11111111111111111111111111111111";
const MINT = "So11111111111111111111111111111111111111112";
const SIGNATURE = "2".repeat(64);
const BLOCKHASH = "3".repeat(32);

test("canonical hashes ignore object key insertion order", () => {
  const left = hashCanonicalJson({ name: "LCKD", nested: { z: 2, a: 1 } });
  const right = hashCanonicalJson({ nested: { a: 1, z: 2 }, name: "LCKD" });

  assert.equal(left, right);
  assert.match(left, /^[a-f0-9]{64}$/);
});

test("replacement requires an actually expired finalized blockhash", () => {
  assert.equal(replacementState(null, true), "blockhash-valid");
  assert.equal(replacementState({ err: { InstructionError: [0, 1] } }, true), "blockhash-valid");
  assert.equal(replacementState(null, false), "failed-or-absent");
  assert.equal(replacementState({ err: null, confirmationStatus: "confirmed" }, false), "processing");
  assert.equal(replacementState({ err: null, confirmationStatus: "finalized" }, false), "finalized");
});

test("issued cleanup waits for strict finalized height and invalid blockhash", () => {
  assert.equal(hasFinalizedIssuedTupleExpired(122, 123, false), false);
  assert.equal(hasFinalizedIssuedTupleExpired(123, 123, false), false);
  assert.equal(hasFinalizedIssuedTupleExpired(124, 123, true), false);
  assert.equal(hasFinalizedIssuedTupleExpired(124, 123, false), true);
  assert.equal(hasFinalizedIssuedTupleExpired(Number.MAX_SAFE_INTEGER + 1, 123, false), false);
});

test("exact confirmed issued receipts block cleanup until finalized", () => {
  assert.equal(classifyExactIssuedReceipt("confirmed"), "processing");
  assert.equal(classifyExactIssuedReceipt("processed"), "processing");
  assert.equal(classifyExactIssuedReceipt(null), "processing");
  assert.equal(classifyExactIssuedReceipt("finalized"), "finalized");
});

test("ALT vector hash preserves address order", () => {
  assert.notEqual(
    hashOrderedAddresses([WALLET, MINT]),
    hashOrderedAddresses([MINT, WALLET]),
  );
});

test("atomic state transitions reject skipped launch phases", () => {
  assert.equal(canTransitionAtomicStatus("prepared", "alt_setup_submitted"), true);
  assert.equal(canTransitionAtomicStatus("alt_setup_submitted", "alt_ready"), true);
  assert.equal(canTransitionAtomicStatus("alt_ready", "atomic_submitted"), true);
  assert.equal(canTransitionAtomicStatus("atomic_submitted", "completed"), true);
  assert.equal(canTransitionAtomicStatus("prepared", "atomic_submitted"), false);
  assert.equal(canTransitionAtomicStatus("completed", "cleanup_required"), false);
});

test("transaction replay requires the exact immutable receipt tuple", () => {
  const receipt = {
    signature: SIGNATURE,
    blockhash: BLOCKHASH,
    lastValidBlockHeight: 123,
  };

  assert.equal(isExactTransactionReplay(receipt, { ...receipt }), true);
  assert.equal(isExactTransactionReplay(receipt, { ...receipt, lastValidBlockHeight: 124 }), false);
  assert.equal(isExactTransactionReplay(receipt, { ...receipt, signature: "4".repeat(64) }), false);
});

test("checkpoint schema rejects unknown fields and unsafe state versions", () => {
  const valid = {
    githubId: "42",
    creatorWallet: WALLET,
    mintAddress: MINT,
    expectedStateVersion: 0,
    previousSignature: null,
    signature: SIGNATURE,
    blockhash: BLOCKHASH,
    lastValidBlockHeight: 123,
    finalizedBlockHeight: 100,
  };

  assert.equal(transactionCheckpointSchema.safeParse(valid).success, true);
  assert.equal(transactionCheckpointSchema.safeParse({ ...valid, injected: true }).success, false);
  assert.equal(transactionCheckpointSchema.safeParse({
    ...valid,
    expectedStateVersion: Number.MAX_SAFE_INTEGER + 1,
  }).success, false);
});

test("cleanup issuance requires an exact phase and finalized block height", () => {
  const valid = {
    githubId: "42",
    creatorWallet: WALLET,
    mintAddress: MINT,
    expectedStateVersion: 2,
    expectedAltStateVersion: 3,
    phase: "deactivate",
    messageHash: "a".repeat(64),
    blockhash: BLOCKHASH,
    lastValidBlockHeight: 123,
    finalizedBlockHeight: 100,
  };

  assert.equal(issueAltCleanupSchema.safeParse(valid).success, true);
  assert.equal(issueAltCleanupSchema.safeParse({ ...valid, phase: "setup" }).success, false);
  assert.equal(issueAltCleanupSchema.safeParse({
    ...valid,
    finalizedBlockHeight: Number.MAX_SAFE_INTEGER + 1,
  }).success, false);
});

test("RPC replay response schema requires both intent and ALT versions", () => {
  const result = {
    intentId: "018f1e9e-15ba-7a12-8c97-6f275f20ce3f",
    status: "alt_setup_submitted",
    stateVersion: 1,
    altStatus: "setup_submitted",
    altStateVersion: 1,
    replayed: true,
  };

  assert.equal(atomicRpcResultSchema.safeParse(result).success, true);
  assert.equal(atomicRpcResultSchema.safeParse({
    ...result,
    altStateVersion: undefined,
  }).success, false);
});

test("owned intent snapshot binds immutable config, metadata, and ordered ALT", () => {
  const config = {
    name: "LCKD", ticker: "LCKD", description: "locked", buyAmountSol: 0.01,
    lockDurationDays: 7, lockPercentage: 99, githubUsername: "builder",
    githubRepo: null, liveUrl: null, twitterUrl: null,
    telegramUrl: null, websiteUrl: null,
  };
  const metadata = {
    metadataUri: "https://example.com/metadata.json",
    imageUri: "https://example.com/image.png",
    name: "LCKD", ticker: "LCKD", description: "locked",
    twitterUrl: null, telegramUrl: null, websiteUrl: null,
  };
  const snapshot = {
    intentId: "018f1e9e-15ba-7a12-8c97-6f275f20ce3f",
    githubId: "42", creatorWallet: WALLET, mintAddress: MINT,
    status: "alt_ready", stateVersion: 2, config,
    configHash: hashCanonicalJson(config), metadata,
    metadataHash: hashCanonicalJson(metadata),
    metadataUri: metadata.metadataUri, imageUri: metadata.imageUri,
    metadataAddress: WALLET,
    altAddress: MINT, altAddresses: [WALLET, MINT],
    altAddressesHash: hashOrderedAddresses([WALLET, MINT]),
    quotedTokenAmount: "1000000", maxQuoteAmount: "11000000",
    plannedLockAmount: null, plannedUnlockTimestamp: null,
    plannedStreamflowFeePercent: null,
    issuedAtomicMessageHash: null, issuedAtomicBlockhash: null,
    issuedAtomicLastValidBlockHeight: null, issuedLockAmount: null,
    issuedUnlockTimestamp: null, issuedAtomicTransaction: null,
    atomicTx: null, atomicBlockhash: null, atomicLastValidBlockHeight: null,
    lockMetadataId: null, lockAmount: null, unlockTimestamp: null,
    expiresAt: "2030-01-01T00:00:00.000+00:00", altStatus: "ready",
    altStateVersion: 2, setupTx: SIGNATURE, setupBlockhash: BLOCKHASH,
    setupLastValidBlockHeight: 123, altDeactivationTx: null,
    issuedSetupMessageHash: "a".repeat(64), issuedSetupBlockhash: BLOCKHASH,
    issuedSetupLastValidBlockHeight: 123,
    issuedSetupRecentSlot: null, issuedSetupTransaction: null,
    issuedCleanupPhase: null, issuedCleanupMessageHash: null,
    issuedCleanupBlockhash: null, issuedCleanupLastValidBlockHeight: null,
    altDeactivationBlockhash: null, altDeactivationLastValidBlockHeight: null,
    altCloseTx: null, altCloseBlockhash: null,
    altCloseLastValidBlockHeight: null, altSetupExpired: false,
  };

  assert.equal(atomicIntentSnapshotSchema.safeParse(snapshot).success, true);
  assert.equal(atomicIntentSnapshotSchema.safeParse({
    ...snapshot,
    expiresAt: "2030-01-01T00:00:00.000Z",
  }).success, true);
  assert.equal(atomicIntentSnapshotSchema.safeParse({ ...snapshot, setupTx: undefined }).success, false);
});
