import assert from "node:assert/strict";
import test from "node:test";
import BN from "bn.js";
import { deriveBackfillStatus, isBackfillComplete, isFullCliffAmount } from "./backfill-locks";

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

// --- completion gating (finding 10) ----------------------------------------

test("complete only when every eligible token has a verified lock", () => {
  assert.equal(isBackfillComplete(10, 10), true);
});

test("a skipped/unrepresented eligible token blocks completion", () => {
  // 10 eligible tokens but only 8 verified canonical locks: 2 were skipped and
  // have no row. Counting present rows alone would flip complete=true wrongly.
  assert.equal(isBackfillComplete(10, 8), false);
});

test("no eligible tokens is trivially complete", () => {
  assert.equal(isBackfillComplete(0, 0), true);
});

test("more done than expected is not treated as complete", () => {
  assert.equal(isBackfillComplete(10, 11), false);
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
