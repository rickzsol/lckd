import assert from "node:assert/strict";
import test from "node:test";
import BN from "bn.js";
import {
  deriveBackfillStatus,
  fullCliffScheduleMismatch,
  isFullCliffAmount,
} from "./backfill-locks";

// --- full-cliff acceptance (finding 3-new) ---------------------------------

test("cliffAmount === deposited is a full cliff", () => {
  assert.equal(isFullCliffAmount(new BN(100), new BN(100)), true);
});

test("cliffAmount === deposited - 1 is a full cliff (SDK residual tail)", () => {
  // The Streamflow SDK's isCliffCloseToDepositedAmount accepts deposited - 1; a
  // strict-equality backfill wrongly skipped these valid locks.
  assert.equal(isFullCliffAmount(new BN(99), new BN(100)), true);
});

test("cliffAmount below deposited - 1 is not a full cliff", () => {
  assert.equal(isFullCliffAmount(new BN(98), new BN(100)), false);
  assert.equal(isFullCliffAmount(new BN(50), new BN(100)), false);
});

test("cliffAmount above deposited is not a full cliff", () => {
  assert.equal(isFullCliffAmount(new BN(101), new BN(100)), false);
});

// --- full-cliff SCHEDULE sanity (finding 3, inverted-schedule) -------------

const validSchedule = {
  start: 1_000,
  cliff: 1_000,
  end: 1_001,
  cliffAmount: new BN(100),
  depositedAmount: new BN(100),
};

test("a canonical full-cliff schedule passes", () => {
  assert.equal(fullCliffScheduleMismatch(validSchedule), null);
});

test("start !== cliff is rejected", () => {
  assert.equal(
    fullCliffScheduleMismatch({ ...validSchedule, start: 900 }),
    "start does not equal cliff",
  );
});

test("inverted schedule (end < cliff) is rejected, not silently accepted", () => {
  // end - cliff is negative here, which satisfies a bare (end - cliff) <= 1 tail
  // check; the explicit end >= cliff guard must reject it.
  assert.equal(
    fullCliffScheduleMismatch({ ...validSchedule, end: 500 }),
    "inverted schedule (end before cliff)",
  );
});

test("post-cliff streaming tail is rejected", () => {
  assert.equal(
    fullCliffScheduleMismatch({ ...validSchedule, end: 5_000 }),
    "schedule has a post-cliff tail",
  );
});

test("cliff that does not release the full deposit is rejected", () => {
  assert.equal(
    fullCliffScheduleMismatch({ ...validSchedule, cliffAmount: new BN(50) }),
    "cliff does not release the full deposit",
  );
});

// --- status derivation (existing behavior, guarded) ------------------------

test("pre-cliff withdrawal is anomalous", () => {
  const status = deriveBackfillStatus(BigInt(100), BigInt(10), false, 2_000, 1_000);
  assert.equal(status, "anomalous");
});

test("full withdrawal after the cliff is withdrawn", () => {
  const status = deriveBackfillStatus(BigInt(100), BigInt(100), false, 1_000, 2_000);
  assert.equal(status, "withdrawn");
});

test("zero withdrawn before the cliff stays locked", () => {
  const status = deriveBackfillStatus(BigInt(100), BigInt(0), false, 2_000, 1_000);
  assert.equal(status, "locked");
});
