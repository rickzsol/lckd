import assert from "node:assert/strict";
import test from "node:test";
import { deriveWithdrawalStatus, type StreamState } from "./lockVerification";

const CLIFF = "2026-01-01T00:00:00.000Z";
const CLIFF_MS = new Date(CLIFF).getTime();
const BEFORE = CLIFF_MS - 1_000;
const AFTER = CLIFF_MS + 1_000;

function state(
  deposited: number,
  withdrawn: number,
  closed = false,
): StreamState {
  return {
    depositedAmount: BigInt(deposited),
    withdrawnAmount: BigInt(withdrawn),
    closed,
  };
}

test("null onchain state means the escrow closed and is withdrawn", () => {
  const result = deriveWithdrawalStatus(BigInt(50), null, CLIFF, AFTER);
  assert.equal(result.status, "withdrawn");
  assert.equal(result.withdrawnAmount, "50");
});

test("withdrawn exceeding deposited is anomalous", () => {
  const result = deriveWithdrawalStatus(BigInt(0), state(100, 150), CLIFF, AFTER);
  assert.equal(result.status, "anomalous");
  assert.equal(result.withdrawnAmount, "150");
});

test("withdrawn dropping below the stored value is anomalous", () => {
  const result = deriveWithdrawalStatus(BigInt(80), state(100, 40), CLIFF, AFTER);
  assert.equal(result.status, "anomalous");
  assert.equal(result.withdrawnAmount, "40");
});

test("a closed escrow is withdrawn", () => {
  const result = deriveWithdrawalStatus(BigInt(0), state(100, 0, true), CLIFF, BEFORE);
  assert.equal(result.status, "withdrawn");
});

test("fully withdrawn deposited amount is withdrawn", () => {
  const result = deriveWithdrawalStatus(BigInt(0), state(100, 100), CLIFF, BEFORE);
  assert.equal(result.status, "withdrawn");
  assert.equal(result.withdrawnAmount, "100");
});

test("partial withdrawal is unlock_eligible", () => {
  const result = deriveWithdrawalStatus(BigInt(0), state(100, 40), CLIFF, BEFORE);
  assert.equal(result.status, "unlock_eligible");
  assert.equal(result.withdrawnAmount, "40");
});

test("zero withdrawn before the cliff stays locked", () => {
  const result = deriveWithdrawalStatus(BigInt(0), state(100, 0), CLIFF, BEFORE);
  assert.equal(result.status, "locked");
});

test("zero withdrawn after the cliff is unlock_eligible", () => {
  const result = deriveWithdrawalStatus(BigInt(0), state(100, 0), CLIFF, AFTER);
  assert.equal(result.status, "unlock_eligible");
});

test("an invalid cliff with valid amounts is anomalous", () => {
  const result = deriveWithdrawalStatus(BigInt(0), state(100, 0), "not-a-date", AFTER);
  assert.equal(result.status, "anomalous");
});
