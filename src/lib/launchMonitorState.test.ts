import assert from "node:assert/strict";
import test from "node:test";
import { parseOfficialLaunchEvent, parseOfficialLaunchResponse, type OfficialLaunchEvent, type OfficialLockEvent } from "./launchMonitor";
import { isMintCandidateAllowed, mergeLaunchState, mergeLockState } from "./launchMonitorState";

const launch: OfficialLaunchEvent = {
  detectedAt: "2026-07-17T00:00:00.000Z",
  lock: null,
  metadataUri: "https://example.com/token.json",
  mintAddress: "11111111111111111111111111111111",
  name: "Official",
  signature: "1".repeat(64),
  slot: 100,
  status: "processed",
  symbol: "LCKD",
};
const lock: OfficialLockEvent = {
  amountRaw: "900000",
  decimals: 6,
  detectedAt: "2026-07-17T00:01:00.000Z",
  lockedPercentage: 90,
  metadataId: "2".repeat(32),
  signature: "2".repeat(64),
  slot: 110,
  status: "processed",
  unlockAt: "2030-03-17T17:46:40.000Z",
};

test("stale launch updates cannot replace or retract newer state", () => {
  const newer = { ...launch, signature: "3".repeat(64), slot: 120 };
  assert.equal(mergeLaunchState(newer, { ...launch, status: "confirmed" }), newer);
  assert.equal(mergeLaunchState(newer, { ...newer, signature: "4".repeat(64), status: "retracted" }), newer);
  assert.equal(mergeLaunchState(newer, { ...newer, status: "retracted" }), null);
});

test("stale lock confirmations and unrelated tombstones are ignored", () => {
  const withNewerLock = mergeLockState(launch, { ...lock, signature: "5".repeat(64), slot: 130 });
  assert.ok(withNewerLock?.lock);
  assert.equal(mergeLockState(withNewerLock, { ...lock, status: "confirmed" }), withNewerLock);
  assert.equal(
    mergeLockState(withNewerLock, { ...lock, signature: "6".repeat(64), slot: 130, status: "retracted" }),
    withNewerLock,
  );
  assert.equal(
    mergeLockState(withNewerLock, { ...withNewerLock.lock, status: "retracted" })?.lock,
    null,
  );
});

test("a retracted unconfirmed launch allows a new mint candidate", () => {
  assert.equal(isMintCandidateAllowed(null, null, launch, "new-mint"), false);
  assert.equal(isMintCandidateAllowed(null, null, null, "new-mint"), true);
  assert.equal(isMintCandidateAllowed("fixed-mint", null, null, "new-mint"), false);
});

test("accepts IPFS metadata and restart tombstones", () => {
  assert.ok(parseOfficialLaunchEvent({ ...launch, metadataUri: "ipfs://metadata" }));
  assert.deepEqual(parseOfficialLaunchResponse({
    epoch: "123e4567-e89b-12d3-a456-426614174000",
    launch: null,
    monitoredWallet: "3XyvG1HC1QvzHmNFejUzGgbj8YCLqDRKcoyrWZPuR7p8",
    version: 0,
  })?.launch, null);
});
