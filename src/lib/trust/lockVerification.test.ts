import assert from "node:assert/strict";
import test from "node:test";
import {
  bindStreamToLock,
  deriveWithdrawalStatus,
  StreamUnavailableError,
  type DecodedStream,
  type LockIdentity,
  type StreamReadResult,
} from "./lockVerification";

const CLIFF = "2026-01-01T00:00:00.000Z";
const CLIFF_MS = new Date(CLIFF).getTime();
const CLIFF_RAW = Math.floor(CLIFF_MS / 1000);
const BEFORE = CLIFF_MS - 1_000;
const AFTER = CLIFF_MS + 1_000;

const PROGRAM = "Str11111111111111111111111111111111111111";
const MINT = "MintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const RECIPIENT = "RcptBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const ESCROW = "EscrCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

function decoded(overrides: Partial<DecodedStream> = {}): DecodedStream {
  return {
    streamProgram: PROGRAM,
    mint: MINT,
    sender: RECIPIENT,
    recipient: RECIPIENT,
    escrowTokens: ESCROW,
    depositedAmount: BigInt(100),
    withdrawnAmount: BigInt(0),
    cliff: CLIFF_RAW,
    cliffAmount: BigInt(100),
    start: CLIFF_RAW,
    end: CLIFF_RAW + 1,
    period: 1,
    amountPerPeriod: BigInt(1),
    isLock: true,
    closed: false,
    ...overrides,
  };
}

function ok(overrides: Partial<DecodedStream> = {}): StreamReadResult {
  return { kind: "ok", stream: decoded(overrides) };
}

function identity(overrides: Partial<LockIdentity> = {}): LockIdentity {
  return {
    streamProgram: PROGRAM,
    mint: MINT,
    recipient: RECIPIENT,
    escrowAta: ESCROW,
    depositedAmount: "100",
    cliffTsRaw: String(CLIFF_RAW),
    ...overrides,
  };
}

// --- binding (finding 3) ---------------------------------------------------

test("a fully matching stream binds with no mismatch", () => {
  assert.equal(bindStreamToLock(decoded(), identity()), null);
});

test("wrong program is rejected", () => {
  assert.match(bindStreamToLock(decoded({ streamProgram: "other" }), identity())!, /program/);
});

test("wrong mint is rejected", () => {
  assert.match(bindStreamToLock(decoded({ mint: "other" }), identity())!, /mint/);
});

test("wrong recipient is rejected", () => {
  assert.match(bindStreamToLock(decoded({ recipient: "other" }), identity())!, /recipient/);
});

test("wrong escrow is rejected", () => {
  assert.match(bindStreamToLock(decoded({ escrowTokens: "other" }), identity())!, /escrow/);
});

test("deposited amount mismatch is rejected", () => {
  assert.match(bindStreamToLock(decoded({ depositedAmount: BigInt(99) }), identity())!, /deposited/);
});

test("cliff mismatch is rejected", () => {
  assert.match(bindStreamToLock(decoded({ cliff: CLIFF_RAW + 5 }), identity())!, /cliff/);
});

test("a non-lock stream type is rejected", () => {
  assert.match(bindStreamToLock(decoded({ isLock: false }), identity())!, /not a token lock/);
});

test("a partial-release schedule (cliffAmount < deposited-1) is rejected", () => {
  assert.match(
    bindStreamToLock(decoded({ cliffAmount: BigInt(50) }), identity())!,
    /full deposit/,
  );
});

test("the canonical cliffAmount === deposited full-cliff binds (finding 3-new)", () => {
  assert.equal(
    bindStreamToLock(decoded({ cliffAmount: BigInt(100), amountPerPeriod: BigInt(1) }), identity()),
    null,
  );
});

test("the SDK cliffAmount === deposited-1 with a one-unit tail binds (finding 3-new)", () => {
  // buildLockParams emits amountPerPeriod 1; the on-chain full cliff can carry a
  // one-unit residual so cliffAmount = depositedAmount - 1. Strict equality wrongly
  // rejected this valid lock; the SDK's isCliffCloseToDepositedAmount accepts it.
  assert.equal(
    bindStreamToLock(
      decoded({ cliffAmount: BigInt(99), amountPerPeriod: BigInt(1), end: CLIFF_RAW + 1 }),
      identity(),
    ),
    null,
  );
});

test("cliffAmount below deposited-1 is not a full cliff (finding 3-new)", () => {
  assert.match(
    bindStreamToLock(decoded({ cliffAmount: BigInt(98) }), identity())!,
    /full deposit/,
  );
});

test("a post-cliff tail is rejected", () => {
  assert.match(bindStreamToLock(decoded({ end: CLIFF_RAW + 100 }), identity())!, /tail/);
});

// --- read-failure handling (finding 2) -------------------------------------

test("an rpc error never becomes a withdrawal: it throws", () => {
  assert.throws(
    () => deriveWithdrawalStatus(BigInt(0), { kind: "rpc_error", message: "boom" }, CLIFF, AFTER),
    StreamUnavailableError,
  );
});

test("an absent account (not_found) never becomes a withdrawal: it throws (finding 2)", () => {
  // A bare null finalized account is not proof of withdrawal. A wrong stream id
  // or wrong cluster reads null too, so absence must abort, never commit withdrawn.
  assert.throws(
    () => deriveWithdrawalStatus(BigInt(0), { kind: "not_found" }, CLIFF, AFTER),
    StreamUnavailableError,
  );
});

test("an absent account after the cliff still throws, never withdrawn (finding 2)", () => {
  // Even at/after the cliff, absence is not positive withdrawal evidence.
  assert.throws(
    () => deriveWithdrawalStatus(BigInt(50), { kind: "not_found" }, CLIFF, AFTER),
    StreamUnavailableError,
  );
});

test("a decoded closed stream after the cliff is withdrawn (positive evidence)", () => {
  const result = deriveWithdrawalStatus(
    BigInt(0),
    ok({ withdrawnAmount: BigInt(100), closed: true }),
    CLIFF,
    AFTER,
  );
  assert.equal(result.status, "withdrawn");
  assert.equal(result.withdrawnAmount, "100");
});

// --- pre-cliff breach (finding 4) ------------------------------------------

test("a decoded closed stream BEFORE the cliff is anomalous, not withdrawn", () => {
  const result = deriveWithdrawalStatus(
    BigInt(0),
    ok({ withdrawnAmount: BigInt(100), closed: true }),
    CLIFF,
    BEFORE,
  );
  assert.equal(result.status, "anomalous");
});

test("a partial withdrawal BEFORE the cliff is anomalous, not unlock_eligible", () => {
  const result = deriveWithdrawalStatus(BigInt(0), ok({ withdrawnAmount: BigInt(40) }), CLIFF, BEFORE);
  assert.equal(result.status, "anomalous");
  assert.equal(result.withdrawnAmount, "40");
});

test("a full withdrawal BEFORE the cliff is anomalous, not withdrawn", () => {
  const result = deriveWithdrawalStatus(
    BigInt(0),
    ok({ withdrawnAmount: BigInt(100), closed: true }),
    CLIFF,
    BEFORE,
  );
  assert.equal(result.status, "anomalous");
});

// --- normal derivation -----------------------------------------------------

test("withdrawn exceeding deposited is anomalous and stores the observed value", () => {
  const result = deriveWithdrawalStatus(BigInt(0), ok({ withdrawnAmount: BigInt(150) }), CLIFF, AFTER);
  assert.equal(result.status, "anomalous");
  assert.equal(result.withdrawnAmount, "150");
});

test("withdrawn dropping below the stored value is anomalous", () => {
  const result = deriveWithdrawalStatus(BigInt(80), ok({ withdrawnAmount: BigInt(40) }), CLIFF, AFTER);
  assert.equal(result.status, "anomalous");
  assert.equal(result.withdrawnAmount, "40");
});

test("fully withdrawn after the cliff is withdrawn", () => {
  const result = deriveWithdrawalStatus(BigInt(0), ok({ withdrawnAmount: BigInt(100) }), CLIFF, AFTER);
  assert.equal(result.status, "withdrawn");
});

test("partial withdrawal after the cliff is unlock_eligible", () => {
  const result = deriveWithdrawalStatus(BigInt(0), ok({ withdrawnAmount: BigInt(40) }), CLIFF, AFTER);
  assert.equal(result.status, "unlock_eligible");
});

test("zero withdrawn before the cliff stays locked", () => {
  const result = deriveWithdrawalStatus(BigInt(0), ok(), CLIFF, BEFORE);
  assert.equal(result.status, "locked");
});

test("zero withdrawn after the cliff is unlock_eligible", () => {
  const result = deriveWithdrawalStatus(BigInt(0), ok(), CLIFF, AFTER);
  assert.equal(result.status, "unlock_eligible");
});

test("an invalid cliff with valid amounts is anomalous", () => {
  const result = deriveWithdrawalStatus(BigInt(0), ok(), "not-a-date", AFTER);
  assert.equal(result.status, "anomalous");
});
